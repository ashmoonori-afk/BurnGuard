using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
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
            try
            {
                if (args.Length != 0)
                {
                    if (args.Length != 3 || args[0] != "--smoke-test" || args[1] != "--smoke-report" || !Path.IsPathRooted(args[2]))
                        throw new InvalidOperationException("Supported diagnostic arguments: --smoke-test --smoke-report <absolute JSON path>.");
                    report = Path.GetFullPath(args[2]);
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
                        Application.Run(new DesktopWindow(identity, activateMessage, report));
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
        private readonly Label status = new Label { Dock = DockStyle.Fill, TextAlign = ContentAlignment.MiddleCenter, Text = "BurnGuard를 시작하고 있습니다…", Font = new Font("Segoe UI", 13) };
        private readonly string identity;
        private readonly string report;
        private readonly uint activateMessage;
        private readonly TaskCompletionSource<string> ready = new TaskCompletionSource<string>(TaskCreationOptions.RunContinuationsAsynchronously);
        private Process service;
        private IntPtr job;
        private Uri origin;
        private bool closing;
        private bool stopped;
        private bool smokeStarted;
        private int port;
        private readonly ToolStrip updateStrip = new ToolStrip { Dock = DockStyle.Bottom, GripStyle = ToolStripGripStyle.Hidden };
        private readonly ToolStripButton checkUpdate = new ToolStripButton("업데이트 확인");
        private readonly ToolStripLabel updateStatus = new ToolStripLabel("업데이트 대기 중");
        private readonly ToolStripButton restartUpdate = new ToolStripButton("다시 시작해 적용") { Visible = false };
        private readonly System.Windows.Forms.Timer updateTimer = new System.Windows.Forms.Timer { Interval = 6 * 60 * 60 * 1000 };
        private readonly CancellationTokenSource updateCancellation = new CancellationTokenSource();
        private UpdateManager updates;
        private VelopackAsset pendingUpdate;
        private bool checkingUpdate;
        private bool updateStarted;
        private bool restartForUpdate;

        internal DesktopWindow(string identity, uint activateMessage, string report)
        {
            this.identity = identity; this.activateMessage = activateMessage; this.report = report;
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
                    throw new InvalidOperationException("Microsoft Edge WebView2 Runtime이 필요합니다. https://developer.microsoft.com/microsoft-edge/webview2/ 에서 Evergreen Runtime을 설치한 뒤 BurnGuard를 다시 실행해 주세요.");
                }
                port = 14070;
                var configuredPort = Environment.GetEnvironmentVariable("BG_PORT");
                if (configuredPort != null && (!int.TryParse(configuredPort, out port) || port < 1024 || port > 65535))
                    throw new InvalidOperationException("BG_PORT must be an integer between 1024 and 65535.");
                var listener = new TcpListener(IPAddress.Loopback, port);
                try { listener.Start(); }
                catch (SocketException) { throw new InvalidOperationException($"포트 {port}를 다른 프로그램이 사용 중입니다. 기존 BurnGuard 서버를 종료한 뒤 다시 실행해 주세요."); }
                finally { listener.Stop(); }
                StartService();
                var completed = await Task.WhenAny(ready.Task, Task.Delay(TimeSpan.FromSeconds(60)));
                if (closing) return;
                if (completed != ready.Task) throw new TimeoutException("BurnGuard 서버가 60초 안에 시작되지 않았습니다.");
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
                web.CoreWebView2.PermissionRequested += (_, args) => args.State = CoreWebView2PermissionState.Deny;
                web.CoreWebView2.ProcessFailed += (_, __) => Fail("화면 프로세스가 종료되었습니다. BurnGuard를 다시 실행해 주세요.");
                web.CoreWebView2.NavigationCompleted += async (_, args) =>
                {
                    if (closing) return;
                    if (!args.IsSuccess) { Fail("BurnGuard 화면을 불러오지 못했습니다."); return; }
                    status.Hide();
                    if (report == null && !updateStarted)
                    {
                        updateStarted = true;
                        updateTimer.Start();
                        await CheckUpdateAsync();
                    }
                    if (report != null && !smokeStarted) { smokeStarted = true; await SmokeAsync(); }
                };
                web.CoreWebView2.Navigate(origin.AbsoluteUri + (report == null ? "" : "?create=slide_deck"));
            }
            catch (Exception exception) { if (!closing) Fail(exception.Message); }
        }

        private bool IsAppUrl(string value) => Uri.TryCreate(value, UriKind.Absolute, out var uri) && origin != null && uri.Scheme == origin.Scheme && uri.Host == origin.Host && uri.Port == origin.Port && string.IsNullOrEmpty(uri.UserInfo);

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
                    updateStatus.Text = "자동 업데이트는 설치 패키지에서 사용할 수 있습니다";
                    updateTimer.Stop();
                    return;
                }
                pendingUpdate = updates.UpdatePendingRestart;
                if (pendingUpdate == null)
                {
                    updateStatus.Text = "업데이트 확인 중…";
                    var available = await updates.CheckForUpdatesAsync();
                    if (closing) return;
                    if (available == null) { updateStatus.Text = "최신 버전입니다 (" + updates.CurrentVersion + ")"; return; }
                    updateStatus.Text = "업데이트 다운로드 중…";
                    var progress = new Progress<int>(value => { if (!closing) updateStatus.Text = "업데이트 다운로드 중… " + value + "%"; });
                    await updates.DownloadUpdatesAsync(available, value => ((IProgress<int>)progress).Report(value), updateCancellation.Token);
                    if (closing) return;
                    pendingUpdate = updates.UpdatePendingRestart;
                    if (pendingUpdate == null) throw new InvalidOperationException("Downloaded update was not staged.");
                }
                updateStatus.Text = "새 버전 " + pendingUpdate.Version + " 준비 완료 · 다음 실행 시 적용 (재시작하면 진행 중인 작업이 중단됩니다)";
                restartUpdate.Visible = true;
            }
            catch (OperationCanceledException) { }
            catch { if (!closing) updateStatus.Text = "업데이트를 확인하지 못했습니다 · 인터넷 연결 또는 배포 상태를 확인해 주세요"; }
            finally { checkingUpdate = false; if (!closing) checkUpdate.Enabled = true; }
        }

        private void OpenExternal(string value)
        {
            if (!Uri.TryCreate(value, UriKind.Absolute, out var uri) || (uri.Scheme != "https" && uri.Scheme != "http") || !string.IsNullOrEmpty(uri.UserInfo)) return;
            try { Process.Start(new ProcessStartInfo(uri.AbsoluteUri) { UseShellExecute = true }); }
            catch { MessageBox.Show(this, "기본 브라우저를 열 수 없습니다.", "BurnGuard"); }
        }

        private void StartService()
        {
            var directory = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "service");
            var executable = Path.Combine(directory, "burnguard-design.exe");
            if (!File.Exists(executable)) throw new InvalidOperationException("service/burnguard-design.exe가 없습니다. 배포 ZIP 전체를 압축 해제한 뒤 실행해 주세요.");
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
                    var expected = "http://127.0.0.1:" + port;
                    if (Convert.ToInt32(data["protocol"]) != 1 || Convert.ToInt32(data["pid"]) != service.Id || (string)data["url"] != expected)
                        throw new InvalidOperationException("Invalid desktop readiness message.");
                    ready.TrySetResult(expected + "/");
                }
                catch { ready.TrySetException(new InvalidOperationException("BurnGuard 시작 응답을 확인할 수 없습니다.")); }
            };
            // Drain both pipes; never expose raw backend output (which can contain private paths) in dialogs.
            service.ErrorDataReceived += (_, __) => { };
            service.Exited += (_, __) =>
            {
                ready.TrySetException(new InvalidOperationException("BurnGuard 서버가 시작 중 종료되었습니다."));
                try { if (!closing && IsHandleCreated) BeginInvoke(new Action(() => { if (!closing) Fail("BurnGuard 서버가 종료되었습니다. 앱을 다시 실행해 주세요."); })); }
                catch (InvalidOperationException) { }
            };
            if (!service.Start()) throw new InvalidOperationException("BurnGuard 서버를 시작할 수 없습니다.");
            if (!Native.AssignProcessToJobObject(job, service.Handle))
            {
                service.Kill();
                throw new InvalidOperationException("BurnGuard 프로세스 종료 보호를 설정할 수 없습니다.");
            }
            service.BeginOutputReadLine(); service.BeginErrorReadLine();
        }

        private async Task SmokeAsync()
        {
            try
            {
                var result = new TaskCompletionSource<string>(TaskCreationOptions.RunContinuationsAsynchronously);
                web.CoreWebView2.Settings.IsWebMessageEnabled = true;
                web.CoreWebView2.WebMessageReceived += (_, args) =>
                {
                    if (IsAppUrl(args.Source)) result.TrySetResult(args.WebMessageAsJson);
                };
                await web.CoreWebView2.ExecuteScriptAsync(@"(() => {
                    const root = document.getElementById('root');
                    const ready = () => root && root.innerText.length > 40 && document.querySelector('select[aria-label=""생성 모델""]')?.options.length > 1;
                    const send = () => {
                        const model = document.querySelector('select[aria-label=""생성 모델""]');
                        const original = model.value;
                        const selected = model.options[1].value;
                        model.value = selected;
                        model.dispatchEvent(new Event('change', { bubbles:true }));
                        requestAnimationFrame(() => {
                            const current = document.querySelector('select[aria-label=""생성 모델""]');
                            const modelSelected = current.value === selected;
                            const effort = document.querySelector('select[aria-label=""추론 강도""]');
                            const vanilla = current.closest('fieldset').querySelector('input[type=""checkbox""]');
                            current.value = original;
                            current.dispatchEvent(new Event('change', { bubbles:true }));
                            window.chrome.webview.postMessage({ title:document.title, reactMounted:!!root, modelSelector:true, modelSelected, modelOptions:current.options.length, effort:effort?.value, vanilla:vanilla?.checked, origin:location.origin });
                        });
                    };
                    if (ready()) { send(); return; }
                    const timer = setTimeout(() => { observer.disconnect(); window.chrome.webview.postMessage({ error:'React/model selector not ready' }); }, 30000);
                    const observer = new MutationObserver(() => { if (ready()) { clearTimeout(timer); observer.disconnect(); send(); } });
                    observer.observe(document.documentElement, {subtree:true, childList:true, attributes:true});
                })()");
                if (await Task.WhenAny(result.Task, Task.Delay(35000)) != result.Task) throw new TimeoutException("WebView smoke result timed out.");
                var dom = Program.Json.Deserialize<Dictionary<string, object>>(await result.Task);
                if (dom.ContainsKey("error")) throw new InvalidOperationException((string)dom["error"]);
                if (!(bool)dom["reactMounted"] || !(bool)dom["modelSelector"] || !(bool)dom["modelSelected"]) throw new InvalidOperationException("React smoke assertion failed.");
                if ((string)dom["effort"] != "low" || !(bool)dom["vanilla"]) throw new InvalidOperationException("Default generation controls must use low effort and vanilla mode.");
                var screenshot = Path.ChangeExtension(report, ".png");
                Directory.CreateDirectory(Path.GetDirectoryName(screenshot));
                using (var stream = File.Create(screenshot)) await web.CoreWebView2.CapturePreviewAsync(CoreWebView2CapturePreviewImageFormat.Png, stream);
                Program.WriteReport(report, new { ok = true, processId = Process.GetCurrentProcess().Id, servicePid = service.Id, webViewVersion = web.CoreWebView2.Environment.BrowserVersionString, screenshot, dom });
            }
            catch (Exception exception) { Program.ExitCode = 1; Program.WriteReport(report, new { ok = false, error = exception.Message }); }
            Close();
        }

        private void Fail(string message)
        {
            if (closing) return;
            Program.ExitCode = 1;
            if (report != null) Program.WriteReport(report, new { ok = false, error = message });
            else MessageBox.Show(this, message, "BurnGuard", MessageBoxButtons.OK, MessageBoxIcon.Error);
            Close();
        }

        private async void OnClosing(object sender, FormClosingEventArgs args)
        {
            if (stopped) return;
            args.Cancel = true;
            if (closing) return;
            closing = true; Enabled = false;
            updateTimer.Stop(); updateCancellation.Cancel();
            status.Text = "작업을 중단하고 BurnGuard를 종료하고 있습니다…"; status.Show(); status.BringToFront();
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
                    catch { MessageBox.Show(this, "업데이트 재시작을 예약하지 못했습니다. BurnGuard를 다시 실행해 주세요.", "BurnGuard"); }
                }
                stopped = true; Close();
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
                throw new InvalidOperationException("Windows 프로세스 종료 보호를 설정할 수 없습니다.");
            }
            return job;
        }
    }
}
