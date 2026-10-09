using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Globalization;
using System.IO;
using System.Net;
using System.Net.Sockets;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using System.Web.Script.Serialization;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;
using Velopack;
using Velopack.Sources;

namespace BurnGuard.Desktop
{
    internal static class Program
    {
        internal static readonly JavaScriptSerializer Json = new JavaScriptSerializer();
        internal static int ExitCode;

        [STAThread]
        private static int Main(string[] args)
        {
            // A second launch must activate the existing window before considering a staged update.
            VelopackApp.Build().SetAutoApplyOnStartup(false).Run();
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            string report = null;
            string smokeProject = null;
            try
            {
                if (args.Length != 0)
                {
                    if (args.Length != 5 || args[0] != "--smoke-test" || args[1] != "--smoke-report" || !Path.IsPathRooted(args[2]) || args[3] != "--smoke-project" || string.IsNullOrWhiteSpace(args[4]))
                        throw new InvalidOperationException("Supported diagnostic arguments: --smoke-test --smoke-report <absolute JSON path> --smoke-project <project id>.");
                    report = Path.GetFullPath(args[2]);
                    smokeProject = args[4];
                    if (string.IsNullOrEmpty(Environment.GetEnvironmentVariable("BG_APP_ROOT")))
                        throw new InvalidOperationException("Smoke tests require an isolated BG_APP_ROOT directory.");
                }
                string profile = Environment.GetEnvironmentVariable("BG_APP_ROOT") ?? Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), ".burnguard");
                if (!Path.IsPathRooted(profile)) throw new InvalidOperationException("BG_APP_ROOT must be an absolute directory.");
                string identity;
                using (var hash = SHA256.Create()) identity = BitConverter.ToString(hash.ComputeHash(Encoding.UTF8.GetBytes(Path.GetFullPath(profile).TrimEnd('\\').ToUpperInvariant()))).Replace("-", "").Substring(0, 24);
                var activateMessage = Native.RegisterWindowMessage("BurnGuard.Activate." + identity);
                using (var mutex = new Mutex(true, "Local\\BurnGuard." + identity, out bool first))
                {
                    if (!first)
                    {
                        Native.PostMessage(new IntPtr(0xffff), activateMessage, IntPtr.Zero, IntPtr.Zero);
                        if (report != null) throw new InvalidOperationException("A BurnGuard window already owns this profile.");
                        return 0;
                    }
                    try
                    {
                        if (report == null)
                        {
                            var updates = CreateUpdateManager();
                            if (updates.IsInstalled && updates.UpdatePendingRestart != null)
                            {
                                updates.WaitExitThenApplyUpdates(updates.UpdatePendingRestart, silent: false, restart: true);
                                return 0;
                            }
                        }
                        Application.Run(new DesktopWindow(identity, activateMessage, report, smokeProject));
                    }
                    finally { mutex.ReleaseMutex(); }
                }
            }
            catch (Exception exception)
            {
                ExitCode = 1;
                if (report != null) WriteReport(report, new { ok = false, error = exception.Message });
                else MessageBox.Show(exception.Message, "BurnGuard", MessageBoxButtons.OK, MessageBoxIcon.Error);
            }
            return ExitCode;
        }

        internal static void WriteReport(string path, object value)
        {
            Directory.CreateDirectory(Path.GetDirectoryName(path));
            File.WriteAllText(path, Json.Serialize(value), new UTF8Encoding(false));
        }

        internal static UpdateManager CreateUpdateManager() => new UpdateManager(new GithubSource("https://github.com/ashmoonori-afk/BurnGuard", null, false));
    }

    internal sealed class DesktopWindow : Form
    {
        private readonly WebView2 web = new WebView2 { Dock = DockStyle.Fill };
        private readonly Label status = new Label { Dock = DockStyle.Fill, TextAlign = ContentAlignment.MiddleCenter, Text = ShellText.Get("starting"), Font = new Font("Segoe UI", 13) };
        private readonly string identity;
        private readonly string report;
        private readonly string smokeProject;
        private readonly uint activateMessage;
        private readonly TaskCompletionSource<string> ready = new TaskCompletionSource<string>(TaskCreationOptions.RunContinuationsAsynchronously);
        private readonly TaskCompletionSource<string> svgDownload = new TaskCompletionSource<string>(TaskCreationOptions.RunContinuationsAsynchronously);
        private readonly TaskCompletionSource<string> pdfDownload = new TaskCompletionSource<string>(TaskCreationOptions.RunContinuationsAsynchronously);
        private Process service;
        private IntPtr job;
        private Uri origin;
        private string bootstrapSecret;
        private bool closing;
        private bool confirmingClose;
        private TaskCompletionSource<int> activeTurnsReply;
        private bool stopped;
        private bool smokeStarted;
        private int smokeStage;
        private Dictionary<string, object> smokeDom;
        private readonly List<string> smokeDownloadEvents = new List<string>();
        private long startupElapsedMs;
        private int port;
        private readonly ToolStrip updateStrip = new ToolStrip { Dock = DockStyle.Bottom, GripStyle = ToolStripGripStyle.Hidden };
        private readonly ToolStripButton checkUpdate = new ToolStripButton(ShellText.Get("updateCheck"));
        private readonly ToolStripLabel updateStatus = new ToolStripLabel(ShellText.Get("updateWaiting"));
        private readonly ToolStripButton restartUpdate = new ToolStripButton(ShellText.Get("updateRestart")) { Visible = false };
        private readonly System.Windows.Forms.Timer updateTimer = new System.Windows.Forms.Timer { Interval = 6 * 60 * 60 * 1000 };
        private readonly CancellationTokenSource updateCancellation = new CancellationTokenSource();
        private UpdateManager updates;
        private VelopackAsset pendingUpdate;
        private bool checkingUpdate;
        private bool updateStarted;
        private bool restartForUpdate;

        internal DesktopWindow(string identity, uint activateMessage, string report, string smokeProject)
        {
            this.identity = identity; this.activateMessage = activateMessage; this.report = report; this.smokeProject = smokeProject;
            Text = "BurnGuard";
            ClientSize = new Size(1280, 850);
            MinimumSize = new Size(900, 640);
            StartPosition = FormStartPosition.CenterScreen;
            if (report != null) { ShowInTaskbar = false; Opacity = 0; }
            AutoScaleMode = AutoScaleMode.Dpi;
            var icon = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "BurnGuard.ico");
            if (File.Exists(icon)) Icon = new Icon(icon);
            Controls.Add(web); Controls.Add(status);
            if (report == null)
            {
                updateStrip.Items.AddRange(new ToolStripItem[] { checkUpdate, updateStatus, restartUpdate });
                Controls.Add(updateStrip);
                checkUpdate.Click += async (_, __) => await CheckUpdateAsync();
                restartUpdate.Click += (_, __) => { restartForUpdate = true; Close(); };
                updateTimer.Tick += async (_, __) => await CheckUpdateAsync();
            }
            Shown += async (_, __) => await StartAsync();
            FormClosing += OnClosing;
        }

        protected override void WndProc(ref Message message)
        {
            if (message.Msg == activateMessage)
            {
                if (WindowState == FormWindowState.Minimized) WindowState = FormWindowState.Normal;
                Show(); Activate(); Native.SetForegroundWindow(Handle);
            }
            base.WndProc(ref message);
        }

        private async Task StartAsync()
        {
            try
            {
                try { CoreWebView2Environment.GetAvailableBrowserVersionString(); }
                catch (WebView2RuntimeNotFoundException)
                {
                    throw new InvalidOperationException(ShellText.Get("webview2Missing"));
                }
                port = 14070;
                var configuredPort = Environment.GetEnvironmentVariable("BG_PORT");
                if (configuredPort != null && (!int.TryParse(configuredPort, out port) || port < 1024 || port > 65535))
                    throw new InvalidOperationException("BG_PORT must be an integer between 1024 and 65535.");
                var listener = new TcpListener(IPAddress.Loopback, port);
                try { listener.Start(); }
                catch (SocketException) { throw new InvalidOperationException(string.Format(ShellText.Get("portBusy"), port)); }
                finally { listener.Stop(); }
                status.Text = ShellText.Get("preparing");
                var startup = Stopwatch.StartNew();
                StartService();
                // Cold profiles seed and validate every bundled sample before readiness.
                var completed = await Task.WhenAny(ready.Task, Task.Delay(TimeSpan.FromSeconds(300)));
                startupElapsedMs = startup.ElapsedMilliseconds;
                if (closing) return;
                if (completed != ready.Task) throw new TimeoutException(ShellText.Get("startTimeout"));
                origin = new Uri(await ready.Task);
                string userData = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "BurnGuard", "WebView2", identity);
                if (report != null) userData = Path.Combine(Environment.GetEnvironmentVariable("BG_APP_ROOT"), "cache", "webview2");
                var environment = await CoreWebView2Environment.CreateAsync(null, userData);
                if (closing) return;
                await web.EnsureCoreWebView2Async(environment);
                web.CoreWebView2.Settings.AreDevToolsEnabled = false;
                web.CoreWebView2.Settings.AreBrowserAcceleratorKeysEnabled = false;
                web.CoreWebView2.Settings.IsStatusBarEnabled = false;
                web.CoreWebView2.Settings.IsWebMessageEnabled = false;
                web.CoreWebView2.Settings.AreHostObjectsAllowed = false;
                web.CoreWebView2.Settings.IsGeneralAutofillEnabled = false;
                web.CoreWebView2.Settings.IsPasswordAutosaveEnabled = false;
                // CoreWebView2.NavigationStarting fires only for top-level documents, leaving sandboxed canvas iframes unaffected.
                web.CoreWebView2.NavigationStarting += (_, args) =>
                {
                    if (IsAppUrl(args.Uri))
                    {
                        if (IsTopLevelAppRoute(new Uri(args.Uri))) return;
                        args.Cancel = true;
                        return;
                    }
                    args.Cancel = true;
                    if (args.IsUserInitiated && !args.IsRedirected) OpenExternal(args.Uri);
                };
                web.CoreWebView2.NewWindowRequested += (_, args) =>
                {
                    args.Handled = true;
                    if (args.IsUserInitiated) OpenExternal(args.Uri);
                };
                web.CoreWebView2.PermissionRequested += (_, args) =>
                {
                    args.State = DiagnosticPermissionState(report != null, args.Uri, origin, args.PermissionKind);
                    if (args.State == CoreWebView2PermissionState.Allow) args.SavesInProfile = false;
                };
                web.CoreWebView2.ProcessFailed += (_, args) => { if (IsFatalProcessFailure(args.ProcessFailedKind)) Fail(ShellText.Get("viewProcessExited")); };
                web.CoreWebView2.NavigationCompleted += async (_, args) =>
                {
                    if (closing) return;
                    if (!args.IsSuccess) { Fail(ShellText.Get("viewLoadFailed")); return; }
                    status.Hide();
                    if (report == null && !updateStarted)
                    {
                        updateStarted = true;
                        updateTimer.Start();
                        await CheckUpdateAsync();
                    }
                    if (report != null && !smokeStarted) { smokeStarted = true; await SmokeAsync(); }
                };
                if (report != null) ConfigureDiagnosticDownloads();
                // The one-time secret lets only this WebView mint the launch capability; the SPA strips the fragment.
                web.CoreWebView2.Navigate(origin.AbsoluteUri + (report == null ? "" : "projects/" + Uri.EscapeDataString(smokeProject)) + "#bg-bootstrap:" + bootstrapSecret);
            }
            catch (Exception exception) { if (!closing) Fail(exception.Message); }
        }

        private bool IsAppUrl(string value) => IsAppUrl(value, origin);

        private static bool IsBootstrapSecret(string value)
        {
            if (value == null || value.Length < 16) return false;
            foreach (var c in value) if (!((c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c == '-' || c == '_')) return false;
            return true;
        }

        private static bool IsAppUrl(string value, Uri expectedOrigin) => Uri.TryCreate(value, UriKind.Absolute, out var uri) && expectedOrigin != null && uri.Scheme == expectedOrigin.Scheme && uri.Host == expectedOrigin.Host && uri.Port == expectedOrigin.Port && string.IsNullOrEmpty(uri.UserInfo);

        private static CoreWebView2PermissionState DiagnosticPermissionState(bool diagnostic, string source, Uri expectedOrigin, CoreWebView2PermissionKind kind) =>
            diagnostic && kind == CoreWebView2PermissionKind.MultipleAutomaticDownloads && IsAppUrl(source, expectedOrigin)
                ? CoreWebView2PermissionState.Allow
                : CoreWebView2PermissionState.Deny;

        // WebView2 recovers GPU, utility, sandbox-helper and subframe renderer failures and reports hangs; only losing the browser or main renderer is fatal.
        private static bool IsFatalProcessFailure(CoreWebView2ProcessFailedKind kind) => kind == CoreWebView2ProcessFailedKind.BrowserProcessExited || kind == CoreWebView2ProcessFailedKind.RenderProcessExited;

        private static bool IsTopLevelAppRoute(Uri uri) => !uri.AbsolutePath.StartsWith("/api/", StringComparison.OrdinalIgnoreCase) && !uri.AbsolutePath.StartsWith("/runtime/", StringComparison.OrdinalIgnoreCase);

        private async Task CheckUpdateAsync()
        {
            if (report != null || closing || checkingUpdate) return;
            checkingUpdate = true; checkUpdate.Enabled = false;
            try
            {
                updates = updates ?? Program.CreateUpdateManager();
                if (!updates.IsInstalled)
                {
                    updateStatus.Text = ShellText.Get("updateUnavailable");
                    updateTimer.Stop();
                    return;
                }
                pendingUpdate = updates.UpdatePendingRestart;
                if (pendingUpdate == null)
                {
                    updateStatus.Text = ShellText.Get("updateChecking");
                    var available = await updates.CheckForUpdatesAsync();
                    if (closing) return;
                    if (available == null) { updateStatus.Text = string.Format(ShellText.Get("updateUpToDate"), updates.CurrentVersion); return; }
                    updateStatus.Text = ShellText.Get("updateDownloading");
                    var progress = new Progress<int>(value => { if (!closing) updateStatus.Text = string.Format(ShellText.Get("updateDownloadingPercent"), value); });
                    await updates.DownloadUpdatesAsync(available, value => ((IProgress<int>)progress).Report(value), updateCancellation.Token);
                    if (closing) return;
                    pendingUpdate = updates.UpdatePendingRestart;
                    if (pendingUpdate == null) throw new InvalidOperationException("Downloaded update was not staged.");
                }
                updateStatus.Text = string.Format(ShellText.Get("updateReady"), pendingUpdate.Version);
                restartUpdate.Visible = true;
            }
            catch (OperationCanceledException) { }
            catch { if (!closing) updateStatus.Text = ShellText.Get("updateCheckFailed"); }
            finally { checkingUpdate = false; if (!closing) checkUpdate.Enabled = true; }
        }

        private void OpenExternal(string value)
        {
            if (!Uri.TryCreate(value, UriKind.Absolute, out var uri) || (uri.Scheme != "https" && uri.Scheme != "http") || !string.IsNullOrEmpty(uri.UserInfo)) return;
            try { Process.Start(new ProcessStartInfo(uri.AbsoluteUri) { UseShellExecute = true }); }
            catch { MessageBox.Show(this, ShellText.Get("browserOpenFailed"), "BurnGuard"); }
        }

        private string startupFailure;

        // Known backend startup_failed codes map to the shell table; unknown codes keep the generic exit message.
        private string StartupFailureMessage(string code)
        {
            if (code != "port_busy" && code != "profile_owned" && code != "invalid_port") return null;
            return ShellText.Get("startup_failed." + code).Replace("{0}", port.ToString());
        }

        private void StartService()
        {
            var directory = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "service");
            var executable = Path.Combine(directory, "burnguard-design.exe");
            if (!File.Exists(executable)) throw new InvalidOperationException(ShellText.Get("serviceMissing"));
            job = Native.CreateKillOnCloseJob();
            var start = new ProcessStartInfo(executable) { WorkingDirectory = directory, UseShellExecute = false, CreateNoWindow = true, RedirectStandardInput = true, RedirectStandardOutput = true, RedirectStandardError = true, StandardOutputEncoding = Encoding.UTF8, StandardErrorEncoding = Encoding.UTF8 };
            start.EnvironmentVariables["BG_DESKTOP"] = "1";
            start.EnvironmentVariables["BG_NO_OPEN"] = "1";
            start.EnvironmentVariables["BG_DEV"] = "0";
            start.EnvironmentVariables["BG_PORT"] = port.ToString();
            start.EnvironmentVariables.Remove("BG_SCAN_PORT");
            service = new Process { StartInfo = start, EnableRaisingEvents = true };
            service.OutputDataReceived += (_, args) =>
            {
                const string prefix = "[burnguard-desktop] ";
                if (args.Data == null || !args.Data.StartsWith(prefix, StringComparison.Ordinal)) return;
                try
                {
                    var data = Program.Json.Deserialize<Dictionary<string, object>>(args.Data.Substring(prefix.Length));
                    if (data.ContainsKey("event") && (string)data["event"] == "startup_failed")
                    {
                        startupFailure = StartupFailureMessage(data.ContainsKey("code") ? data["code"] as string : null);
                        if (startupFailure != null) ready.TrySetException(new InvalidOperationException(startupFailure));
                        return;
                    }
                    if (Convert.ToInt32(data["protocol"]) == 1 && data.TryGetValue("event", out var kind) && (kind as string) == "active-turns")
                    {
                        activeTurnsReply?.TrySetResult(Convert.ToInt32(data["count"]));
                        return;
                    }
                    var expected = "http://127.0.0.1:" + port;
                    var bootstrap = data.ContainsKey("bootstrap") ? data["bootstrap"] as string : null;
                    if (Convert.ToInt32(data["protocol"]) != 1 || Convert.ToInt32(data["pid"]) != service.Id || (string)data["url"] != expected || !IsBootstrapSecret(bootstrap))
                        throw new InvalidOperationException("Invalid desktop readiness message.");
                    bootstrapSecret = bootstrap;
                    ready.TrySetResult(expected + "/");
                }
                catch { ready.TrySetException(new InvalidOperationException(ShellText.Get("startupResponseInvalid"))); }
            };
            // Drain both pipes; never expose raw backend output (which can contain private paths) in dialogs.
            service.ErrorDataReceived += (_, __) => { };
            service.Exited += (_, __) =>
            {
                // Let the redirected stdout finish so a startup_failed line is seen before the generic exit message.
                try { service.WaitForExit(); } catch (InvalidOperationException) { }
                if (startupFailure != null) { ready.TrySetException(new InvalidOperationException(startupFailure)); return; }
                ready.TrySetException(new InvalidOperationException(ShellText.Get("serverExitedDuringStartup")));
                try { if (!closing && IsHandleCreated) BeginInvoke(new Action(() => { if (!closing) Fail(ShellText.Get("serverExited")); })); }
                catch (InvalidOperationException) { }
            };
            if (!service.Start()) throw new InvalidOperationException(ShellText.Get("serviceStartFailed"));
            if (!Native.AssignProcessToJobObject(job, service.Handle))
            {
                service.Kill();
                throw new InvalidOperationException(ShellText.Get("processProtectionFailed"));
            }
            service.BeginOutputReadLine(); service.BeginErrorReadLine();
        }

        private void ConfigureDiagnosticDownloads()
        {
            web.CoreWebView2.DownloadStarting += (_, args) =>
            {
                var mime = args.DownloadOperation.MimeType;
                var suggested = Path.GetFileName(args.ResultFilePath);
                var extension = DiagnosticDownloadExtension(suggested, mime);
                var completion = extension == ".svg" ? svgDownload : extension == ".pdf" ? pdfDownload : null;
                if (completion == null)
                {
                    args.Cancel = true;
                    var failure = new InvalidOperationException("Unexpected native download: " + suggested + " (" + mime + ").");
                    svgDownload.TrySetException(failure);
                    pdfDownload.TrySetException(failure);
                    return;
                }
                var destination = Path.Combine(Path.GetDirectoryName(report), "native-export" + extension);
                if (File.Exists(destination)) File.Delete(destination);
                args.ResultFilePath = destination;
                args.Handled = true;
                var operation = args.DownloadOperation;
                smokeDownloadEvents.Add("native-start:" + extension + ":" + operation.State + ":" + mime + ":" + suggested);
                ObserveDiagnosticDownload(
                    handler => operation.StateChanged += handler,
                    handler => operation.StateChanged -= handler,
                    () => operation.State,
                    state => smokeDownloadEvents.Add("native-state:" + extension + ":" + state),
                    state =>
                    {
                        if (state == CoreWebView2DownloadState.Completed) completion.TrySetResult(destination);
                        else completion.TrySetException(new InvalidOperationException("Native " + extension + " download was interrupted."));
                    });
            };
        }

        private static void ObserveDiagnosticDownload(
            Action<EventHandler<object>> subscribe,
            Action<EventHandler<object>> unsubscribe,
            Func<CoreWebView2DownloadState> readState,
            Action<CoreWebView2DownloadState> observed,
            Action<CoreWebView2DownloadState> terminal)
        {
            var settled = false;
            EventHandler<object> changed = null;
            Action inspect = () =>
            {
                var state = readState();
                observed(state);
                if (state == CoreWebView2DownloadState.InProgress || settled) return;
                settled = true;
                unsubscribe(changed);
                terminal(state);
            };
            changed = (_, __) => inspect();
            subscribe(changed);
            inspect();
        }

        private static string DiagnosticDownloadExtension(string suggested, string mime)
        {
            var extension = Path.GetExtension(suggested).ToLowerInvariant();
            if (extension == ".svg" || extension == ".pdf") return extension;
            return mime == "image/svg+xml" ? ".svg" : mime == "application/pdf" ? ".pdf" : null;
        }

        private async Task SmokeAsync()
        {
            try
            {
                if (smokeStage == 0)
                {
                    var first = await ExecuteSmokeScriptAsync(SmokeEditScript, 90000);
                    if (!(bool)first["canvasReady"] || !(bool)first["savePersisted"])
                        throw new InvalidOperationException("Product canvas edit did not persist.");
                    smokeDom = first;
                    smokeStage = 1;
                    smokeStarted = false;
                    web.CoreWebView2.Reload();
                    return;
                }

                var second = await ExecuteSmokeScriptAsync(SmokeReloadAndExportScript, 240000);
                if (!(bool)second["reloadPersisted"] || !(bool)second["exportsCompleted"])
                    throw new InvalidOperationException("Reload or export acceptance failed.");
                foreach (var entry in second) smokeDom[entry.Key] = entry.Value;
                var downloads = await Task.WhenAll(WaitDownload(svgDownload.Task), WaitDownload(pdfDownload.Task));
                var svg = ArtifactEvidence(downloads[0], "svg");
                var pdf = ArtifactEvidence(downloads[1], "pdf");
                var screenshot = Path.ChangeExtension(report, ".png");
                Directory.CreateDirectory(Path.GetDirectoryName(screenshot));
                using (var stream = File.Create(screenshot)) await web.CoreWebView2.CapturePreviewAsync(CoreWebView2CapturePreviewImageFormat.Png, stream);
                Program.WriteReport(report, new { ok = true, startupElapsedMs, processId = Process.GetCurrentProcess().Id, servicePid = service.Id, webViewVersion = web.CoreWebView2.Environment.BrowserVersionString, screenshot, dom = smokeDom, artifacts = new { svg, pdf }, downloadEvents = smokeDownloadEvents });
            }
            catch (Exception exception) { Program.ExitCode = 1; Program.WriteReport(report, new { ok = false, startupElapsedMs, error = exception.Message, downloadEvents = smokeDownloadEvents }); }
            Close();
        }

        private async Task<Dictionary<string, object>> ExecuteSmokeScriptAsync(string script, int timeoutMs)
        {
            var result = new TaskCompletionSource<string>(TaskCreationOptions.RunContinuationsAsynchronously);
            EventHandler<CoreWebView2WebMessageReceivedEventArgs> received = null;
            received = (_, args) =>
            {
                if (!IsAppUrl(args.Source)) return;
                var message = Program.Json.Deserialize<Dictionary<string, object>>(args.WebMessageAsJson);
                if (message.ContainsKey("downloadAction"))
                {
                    smokeDownloadEvents.Add("browser-action:" + (string)message["downloadAction"]);
                    return;
                }
                web.CoreWebView2.WebMessageReceived -= received;
                result.TrySetResult(args.WebMessageAsJson);
            };
            web.CoreWebView2.Settings.IsWebMessageEnabled = true;
            web.CoreWebView2.WebMessageReceived += received;
            await web.CoreWebView2.ExecuteScriptAsync(script.Replace("__PROJECT_ID__", Program.Json.Serialize(smokeProject)));
            if (await Task.WhenAny(result.Task, Task.Delay(timeoutMs)) != result.Task)
            {
                web.CoreWebView2.WebMessageReceived -= received;
                throw new TimeoutException("WebView product acceptance timed out.");
            }
            var value = Program.Json.Deserialize<Dictionary<string, object>>(await result.Task);
            if (value.ContainsKey("error")) throw new InvalidOperationException((string)value["error"]);
            return value;
        }

        private static async Task<string> WaitDownload(Task<string> download)
        {
            if (await Task.WhenAny(download, Task.Delay(60000)) != download) throw new TimeoutException("Native download completion timed out.");
            return await download;
        }

        private static object ArtifactEvidence(string path, string format)
        {
            var bytes = File.ReadAllBytes(path);
            if (bytes.Length == 0) throw new InvalidOperationException(format.ToUpperInvariant() + " download was empty.");
            if (format == "pdf" && (bytes.Length < 5 || Encoding.ASCII.GetString(bytes, 0, 5) != "%PDF-")) throw new InvalidOperationException("PDF signature was invalid.");
            if (format == "svg")
            {
                var prefix = Encoding.UTF8.GetString(bytes, 0, Math.Min(bytes.Length, 4096));
                if (prefix.IndexOf("<svg", StringComparison.OrdinalIgnoreCase) < 0) throw new InvalidOperationException("SVG root was invalid.");
            }
            string digest;
            using (var hash = SHA256.Create()) digest = BitConverter.ToString(hash.ComputeHash(bytes)).Replace("-", "").ToLowerInvariant();
            return new { path, format, bytes = bytes.Length, sha256 = digest };
        }

        private const string SmokeEditScript = @"(async () => {
            try {
                const projectId = __PROJECT_ID__, marker = 'NATIVE_WINDOWS_PERSISTED';
                const waitFor = (check, timeoutMs) => { const immediate = check(); if (immediate) return Promise.resolve(immediate); return new Promise((resolve, reject) => { const observer = new MutationObserver(() => { const value = check(); if (!value) return; clearTimeout(timer); observer.disconnect(); resolve(value); }); observer.observe(document.documentElement, {subtree:true, childList:true, attributes:true, characterData:true}); const timer = setTimeout(() => { observer.disconnect(); reject(new Error('Canvas readiness deadline exceeded')); }, timeoutMs); }); };
                const data = async response => { const body = await response.json(); if (!response.ok || !body.data) throw new Error('HTTP ' + response.status); return body.data; };
                const frame = await waitFor(() => { const value = [...document.querySelectorAll('iframe')].find(item => item.srcdoc?.includes('NATIVE_WINDOWS_BASELINE')); return value?.srcdoc?.includes('NATIVE_WINDOWS_BASELINE') ? value : null; }, 60000);
                const before = await data(await fetch('/api/projects/' + projectId));
                const authority = await data(await fetch('/api/bootstrap'));
                const file = await fetch('/api/projects/' + projectId + '/fs/index.html?node_bg_id=native-windows-title');
                if (!file.ok) throw new Error('Fixture file unavailable');
                const response = await fetch('/api/projects/' + projectId + '/fs/index.html', { method:'PATCH', headers:{'content-type':'application/json','x-burnguard-capability':authority.capability}, body:JSON.stringify({ expected_revision:Number(file.headers.get('x-burnguard-revision')), expected_artifact_digest:file.headers.get('x-burnguard-artifact-digest'), expected_file_hash:file.headers.get('x-burnguard-file-hash'), node_bg_id:'native-windows-title', node_fingerprint:file.headers.get('x-burnguard-node-fingerprint'), text:marker }) });
                const saved = await data(response);
                if (saved.result_revision !== before.current_revision + 1) throw new Error('Revision did not advance exactly once');
                window.chrome.webview.postMessage({ canvasReady:!!frame, savePersisted:true, projectId, origin:location.origin, baseRevision:before.current_revision, savedRevision:saved.result_revision, marker });
            } catch (error) { window.chrome.webview.postMessage({error:String(error?.message ?? error)}); }
        })();";

        private const string SmokeReloadAndExportScript = @"(async () => {
            let source;
            try {
                const projectId = __PROJECT_ID__, marker = 'NATIVE_WINDOWS_PERSISTED';
                const waitFor = (check, timeoutMs) => { const immediate = check(); if (immediate) return Promise.resolve(immediate); return new Promise((resolve, reject) => { const observer = new MutationObserver(() => { const value = check(); if (!value) return; clearTimeout(timer); observer.disconnect(); resolve(value); }); observer.observe(document.documentElement, {subtree:true, childList:true, attributes:true,characterData:true}); const timer=setTimeout(()=>{observer.disconnect();reject(new Error('Reload readiness deadline exceeded'));},timeoutMs); }); };
                const data = async response => { const body=await response.json(); if(!response.ok || !body.data) throw new Error('HTTP '+response.status); return body.data; };
                const frame = await waitFor(() => [...document.querySelectorAll('iframe')].find(item => item.srcdoc?.includes(marker)) ?? null, 60000);
                const project = await data(await fetch('/api/projects/' + projectId));
                const authority = await data(await fetch('/api/bootstrap'));
                const session = await data(await fetch('/api/projects/' + projectId + '/session'));
                const events = new Map(), waiters = new Map();
                source = new EventSource('/api/sessions/' + session.id + '/stream');
                const opened = new Promise((resolve,reject)=>{ const timer=setTimeout(()=>reject(new Error('Export event stream deadline exceeded')),15000); source.onopen=()=>{clearTimeout(timer);resolve();}; source.onerror=()=>{clearTimeout(timer);reject(new Error('Export event stream failed'));}; });
                source.onmessage = message => { const envelope=JSON.parse(message.data), event=envelope.event; if(event?.type!=='export.attempt')return; events.set(event.jobId,event); const waiter=waiters.get(event.jobId); if(waiter && ['validated','failed','cancelled','corrupt'].includes(event.status)) waiter(event); };
                await opened;
                const run = async (format, options) => {
                    const created = await data(await fetch('/api/projects/' + projectId + '/exports', {method:'POST',headers:{'content-type':'application/json','x-burnguard-capability':authority.capability},body:JSON.stringify({format,options})}));
                    const terminal = await new Promise((resolve,reject)=>{ const timer=setTimeout(()=>{waiters.delete(created.id);reject(new Error(format+' export deadline exceeded'));},180000); const finish=event=>{if(!['validated','failed','cancelled','corrupt'].includes(event.status))return;clearTimeout(timer);waiters.delete(created.id);resolve(event);}; waiters.set(created.id,finish); const known=events.get(created.id); if(known)finish(known); });
                    if(terminal.status!=='validated')throw new Error(format+' export ended as '+terminal.status+' ('+(terminal.stopReason??'no stop reason')+')');
                    const job=await data(await fetch('/api/exports/'+created.id));
                    if(job.status!=='succeeded'||!job.latest_attempt?.digests?.output||job.size_bytes<=0)throw new Error(format+' export receipt invalid');
                    const response=await fetch('/api/exports/'+created.id+'/download'); if(!response.ok)throw new Error(format+' download unavailable');
                    const blob=await response.blob(), url=URL.createObjectURL(blob), link=document.createElement('a'); link.href=url; link.download='native-export.'+format; window.chrome.webview.postMessage({downloadAction:format}); link.click(); setTimeout(()=>URL.revokeObjectURL(url),1000);
                    return {id:job.id,bytes:job.size_bytes,sha256:job.latest_attempt.digests.output};
                };
                const svg=await run('svg',{}), pdf=await run('pdf',{pdf_paper:'artboard'});
                source.close();
                window.chrome.webview.postMessage({reloadPersisted:!!frame,exportsCompleted:true,reloadedRevision:project.current_revision,exports:{svg,pdf}});
            } catch (error) { source?.close(); window.chrome.webview.postMessage({error:String(error?.message ?? error)}); }
        })();";

        private void Fail(string message)
        {
            if (closing) return;
            Program.ExitCode = 1;
            if (report != null) Program.WriteReport(report, new { ok = false, startupElapsedMs, error = message });
            else MessageBox.Show(this, message, "BurnGuard", MessageBoxButtons.OK, MessageBoxIcon.Error);
            Close();
        }

        // The backend answers "active-turns" on the readiness channel; no answer in two seconds counts as idle, so a hung backend never blocks closing.
        private async Task<int> ActiveTurnCountAsync()
        {
            if (origin == null || service == null || service.HasExited) return 0;
            var reply = new TaskCompletionSource<int>(TaskCreationOptions.RunContinuationsAsynchronously);
            activeTurnsReply = reply;
            try { await service.StandardInput.WriteLineAsync("active-turns"); await service.StandardInput.FlushAsync(); }
            catch (IOException) { return 0; }
            catch (InvalidOperationException) { return 0; }
            return await Task.WhenAny(reply.Task, Task.Delay(2000)) == reply.Task ? reply.Task.Result : 0;
        }

        // Keep working is the default and the answer to Esc or the title-bar close.
        private bool ConfirmCloseDuringTurn()
        {
            using (var dialog = new Form { Text = "BurnGuard", FormBorderStyle = FormBorderStyle.FixedDialog, StartPosition = FormStartPosition.CenterParent, MinimizeBox = false, MaximizeBox = false, ShowInTaskbar = false, AutoSize = true, AutoSizeMode = AutoSizeMode.GrowAndShrink, Padding = new Padding(16), Font = new Font("Segoe UI", 10) })
            {
                var layout = new TableLayoutPanel { ColumnCount = 1, AutoSize = true, Dock = DockStyle.Fill };
                var buttons = new FlowLayoutPanel { FlowDirection = FlowDirection.RightToLeft, AutoSize = true, Dock = DockStyle.Fill, Margin = new Padding(0, 16, 0, 0) };
                var keep = new Button { Text = ShellText.Get("closeRunning.keep"), DialogResult = DialogResult.Cancel, AutoSize = true };
                var close = new Button { Text = ShellText.Get("closeRunning.close"), DialogResult = DialogResult.OK, AutoSize = true };
                buttons.Controls.Add(keep); buttons.Controls.Add(close);
                layout.Controls.Add(new Label { Text = ShellText.Get("closeRunning.message"), AutoSize = true, MaximumSize = new Size(420, 0) });
                layout.Controls.Add(buttons);
                dialog.Controls.Add(layout);
                dialog.AcceptButton = keep; dialog.CancelButton = keep;
                return dialog.ShowDialog(this) == DialogResult.OK;
            }
        }

        private async void OnClosing(object sender, FormClosingEventArgs args)
        {
            if (stopped) return;
            args.Cancel = true;
            if (closing || confirmingClose) return;
            // Ask before interrupting a generation; smoke runs, failures and Windows logoff close without a prompt.
            if (report == null && Program.ExitCode == 0 && args.CloseReason == CloseReason.UserClosing)
            {
                confirmingClose = true;
                try { if (await ActiveTurnCountAsync() > 0 && !ConfirmCloseDuringTurn()) { restartForUpdate = false; return; } }
                finally { confirmingClose = false; activeTurnsReply = null; }
            }
            closing = true; Enabled = false;
            updateTimer.Stop(); updateCancellation.Cancel();
            status.Text = ShellText.Get("shutdown"); status.Show(); status.BringToFront();
            try
            {
                if (service != null && !service.HasExited)
                {
                    try { await service.StandardInput.WriteLineAsync("shutdown"); await service.StandardInput.FlushAsync(); service.StandardInput.Close(); } catch (IOException) { }
                    await Task.Run(() => service.WaitForExit(10000));
                }
            }
            catch (InvalidOperationException) { }
            finally
            {
                if (job != IntPtr.Zero) { Native.CloseHandle(job); job = IntPtr.Zero; }
                web.Dispose(); service?.Dispose(); updateTimer.Dispose();
                // Schedule only after the owned backend and its job have stopped; never force-exit active work.
                if (restartForUpdate && pendingUpdate != null)
                {
                    try { updates.WaitExitThenApplyUpdates(pendingUpdate, silent: false, restart: true); }
                    catch { MessageBox.Show(this, ShellText.Get("updateRestartFailed"), "BurnGuard"); }
                }
                stopped = true; Close();
            }
        }
    }

    // Shell dialog strings live in i18n/<language>.json (embedded); the language follows the SPA's first-run rule.
    internal static class ShellText
    {
        private static readonly Dictionary<string, string> Fallback = Load("en");
        private static readonly Dictionary<string, string> Active = Load(Language(CultureInfo.CurrentUICulture));

        // Korean -> ko, Simplified Chinese -> zh, anything else (including Traditional Chinese) -> en.
        internal static string Language(CultureInfo culture)
        {
            if (culture.TwoLetterISOLanguageName == "ko") return "ko";
            if (culture.TwoLetterISOLanguageName != "zh") return "en";
            var name = culture.Name.ToLowerInvariant();
            if (name.Contains("hans")) return "zh";
            return name.Contains("hant") || name.EndsWith("-tw") || name.EndsWith("-hk") || name.EndsWith("-mo") ? "en" : "zh";
        }

        internal static string Get(string key) => Active.TryGetValue(key, out var value) || Fallback.TryGetValue(key, out value) ? value : key;

        private static Dictionary<string, string> Load(string language)
        {
            using (var stream = typeof(ShellText).Assembly.GetManifestResourceStream("BurnGuard.Desktop.i18n." + language + ".json"))
            {
                if (stream == null) return new Dictionary<string, string>();
                using (var reader = new StreamReader(stream, Encoding.UTF8)) return Program.Json.Deserialize<Dictionary<string, string>>(reader.ReadToEnd());
            }
        }
    }

    internal static class Native
    {
        [DllImport("user32.dll", CharSet = CharSet.Unicode)] internal static extern uint RegisterWindowMessage(string value);
        [DllImport("user32.dll")] internal static extern bool PostMessage(IntPtr window, uint message, IntPtr wParam, IntPtr lParam);
        [DllImport("user32.dll")] internal static extern bool SetForegroundWindow(IntPtr window);
        [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] private static extern IntPtr CreateJobObject(IntPtr attributes, string name);
        [DllImport("kernel32.dll", SetLastError = true)] private static extern bool SetInformationJobObject(IntPtr job, int kind, ref JobLimits limits, uint length);
        [DllImport("kernel32.dll", SetLastError = true)] internal static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);
        [DllImport("kernel32.dll")] internal static extern bool CloseHandle(IntPtr handle);
        [StructLayout(LayoutKind.Sequential)] private struct BasicLimits { public long ProcessTime, JobTime; public uint Flags; public UIntPtr MinWorkingSet, MaxWorkingSet; public uint ActiveProcesses; public UIntPtr Affinity; public uint Priority, Scheduling; }
        [StructLayout(LayoutKind.Sequential)] private struct IoCounters { public ulong ReadOperations, WriteOperations, OtherOperations, ReadBytes, WriteBytes, OtherBytes; }
        [StructLayout(LayoutKind.Sequential)] private struct JobLimits { public BasicLimits Basic; public IoCounters Io; public UIntPtr ProcessMemory, JobMemory, PeakProcessMemory, PeakJobMemory; }
        internal static IntPtr CreateKillOnCloseJob()
        {
            var job = CreateJobObject(IntPtr.Zero, null);
            var limits = new JobLimits { Basic = new BasicLimits { Flags = 0x2000 } };
            if (job == IntPtr.Zero || !SetInformationJobObject(job, 9, ref limits, (uint)Marshal.SizeOf(typeof(JobLimits))))
            {
                if (job != IntPtr.Zero) CloseHandle(job);
                throw new InvalidOperationException(ShellText.Get("processProtectionFailed"));
            }
            return job;
        }
    }
}
