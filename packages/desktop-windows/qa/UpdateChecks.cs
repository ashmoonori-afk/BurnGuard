using System;
using System.Reflection;
using System.Threading;
using System.Threading.Tasks;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;
using Velopack;
using Velopack.Sources;

// Runs native update UI logic without opening a window, backend, profile, or network connection.
internal static class UpdateChecks
{
    private static readonly Type Window = Assembly.Load("BurnGuard").GetType("BurnGuard.Desktop.DesktopWindow", true);
    private const BindingFlags Fields = BindingFlags.Instance | BindingFlags.NonPublic;
    private static readonly ConstructorInfo WindowConstructor = Window.GetConstructor(Fields, null, new[] { typeof(string), typeof(uint), typeof(string), typeof(string) }, null)
        ?? throw new MissingMethodException(Window.FullName, ".ctor(string,uint,string,string)");
    private static object Field(Form form, string name) => Window.GetField(name, Fields).GetValue(form);
    private static void Assert(bool value, string description) { if (!value) throw new Exception(description); }

    [STAThread]
    private static void Main()
    {
        VelopackApp.Build().Run();
        CheckDownloadRouting();
        CheckDownloadObservation();
        Check(new FakeUpdates { Installed = false }, null, "설치 패키지", false, 0, 0);
        Check(new FakeUpdates(), "isolated-smoke.json", "대기 중", false, 0, 0);
        Check(new FakeUpdates(), null, "최신 버전", false, 1, 0);
        Check(new FakeUpdates { Offline = true }, null, "확인하지 못했습니다", false, 1, 0);
        Check(new FakeUpdates { Available = true }, null, "준비 완료", true, 1, 1);
        Check(new FakeUpdates { Available = true, DownloadFails = true }, null, "확인하지 못했습니다", false, 1, 1);
        Console.WriteLine("PASS: portable, smoke, current, offline, staged/recheck, failed download; no live update applied.");
    }

    private static void CheckDownloadRouting()
    {
        var route = Window.GetMethod("DiagnosticDownloadExtension", BindingFlags.Static | BindingFlags.NonPublic)
            ?? throw new MissingMethodException(Window.FullName, "DiagnosticDownloadExtension");
        Assert((string)route.Invoke(null, new object[] { "native-export.svg", "application/octet-stream" }) == ".svg", "SVG filename must route a generic blob MIME");
        Assert((string)route.Invoke(null, new object[] { "native-export.pdf", "application/octet-stream" }) == ".pdf", "PDF filename must route a generic blob MIME");
        Assert((string)route.Invoke(null, new object[] { "download", "application/pdf" }) == ".pdf", "PDF MIME fallback must remain available");
        Assert(route.Invoke(null, new object[] { "download.bin", "application/octet-stream" }) == null, "Unknown downloads must fail closed");
    }

    private static void CheckDownloadObservation()
    {
        var observe = Window.GetMethod("ObserveDiagnosticDownload", BindingFlags.Static | BindingFlags.NonPublic)
            ?? throw new MissingMethodException(Window.FullName, "ObserveDiagnosticDownload");

        CheckDownloadSchedule(observe, CoreWebView2DownloadState.Completed, false, false, 1, 1);
        CheckDownloadSchedule(observe, CoreWebView2DownloadState.InProgress, true, false, 2, 1);
        CheckDownloadSchedule(observe, CoreWebView2DownloadState.Completed, false, true, 2, 1);
    }

    private static void CheckDownloadSchedule(MethodInfo observe, CoreWebView2DownloadState initial, bool completeLater, bool eventDuringSubscribe, int expectedObservations, int expectedSettlements)
    {
        var state = initial;
        EventHandler<object> handler = null;
        var subscriptions = 0;
        var unsubscriptions = 0;
        var observations = 0;
        var settlements = 0;
        var terminal = CoreWebView2DownloadState.InProgress;
        var subscribe = new Action<EventHandler<object>>(value =>
        {
            subscriptions++;
            handler = value;
            if (eventDuringSubscribe) handler(null, null);
        });
        var unsubscribe = new Action<EventHandler<object>>(value =>
        {
            Assert(value == handler, "Download observer unsubscribed a different handler");
            unsubscriptions++;
        });
        observe.Invoke(null, new object[] {
            subscribe,
            unsubscribe,
            new Func<CoreWebView2DownloadState>(() => state),
            new Action<CoreWebView2DownloadState>(_ => observations++),
            new Action<CoreWebView2DownloadState>(value => { settlements++; terminal = value; }),
        });
        if (completeLater)
        {
            Assert(settlements == 0 && unsubscriptions == 0, "In-progress download settled before StateChanged");
            state = CoreWebView2DownloadState.Completed;
            handler(null, null);
        }
        Assert(subscriptions == 1, "Download observer subscribed more than once");
        Assert(observations == expectedObservations, "Unexpected download state observation count");
        Assert(settlements == expectedSettlements && terminal == CoreWebView2DownloadState.Completed, "Download completion did not settle exactly once");
        Assert(unsubscriptions == 1, "Download observer did not unsubscribe exactly once");
    }

    private static void Check(FakeUpdates updates, string report, string expected, bool staged, int checks, int downloads)
    {
        using (var form = (Form)WindowConstructor.Invoke(new object[] { "update-qa", (uint)0, report, null }))
        {
            Window.GetField("updates", Fields).SetValue(form, updates);
            ((Task)Window.GetMethod("CheckUpdateAsync", Fields).Invoke(form, null)).GetAwaiter().GetResult();
            Assert(((ToolStripLabel)Field(form, "updateStatus")).Text.Contains(expected), "Wrong update status: " + expected);
            Assert((Field(form, "pendingUpdate") != null) == staged, "Wrong pending update state");
            Assert(updates.Checks == checks && updates.Downloads == downloads, "Unexpected network operation count");
            Assert(!(bool)Field(form, "restartForUpdate"), "Background check must never request restart");
            Assert(((ToolStripButton)Field(form, "checkUpdate")).Enabled, "Retry button remained disabled");
            if (staged)
            {
                ((Task)Window.GetMethod("CheckUpdateAsync", Fields).Invoke(form, null)).GetAwaiter().GetResult();
                Assert(updates.Checks == checks && updates.Downloads == downloads, "Staged update was downloaded again");
            }
            ((System.Windows.Forms.Timer)Field(form, "updateTimer")).Dispose();
            ((CancellationTokenSource)Field(form, "updateCancellation")).Dispose();
        }
    }

    private sealed class FakeUpdates : UpdateManager
    {
        internal bool Installed = true, Offline, Available, DownloadFails;
        internal int Checks, Downloads;
        private VelopackAsset staged;
        internal FakeUpdates() : base(new SimpleWebSource("https://example.invalid")) { }
        public override bool IsInstalled => Installed;
        public override SemanticVersion CurrentVersion => SemanticVersion.Parse("1.0.0");
        public override VelopackAsset UpdatePendingRestart => staged;
        public override Task<UpdateInfo> CheckForUpdatesAsync()
        {
            Checks++;
            if (Offline) throw new System.IO.IOException("offline");
            return Task.FromResult(Available ? new UpdateInfo(new VelopackAsset { Version = SemanticVersion.Parse("1.0.1") }, false) : null);
        }
        public override Task DownloadUpdatesAsync(UpdateInfo update, Action<int> progress = null, CancellationToken cancelToken = default)
        {
            Downloads++;
            if (DownloadFails) throw new System.IO.IOException("download failed");
            staged = update.TargetFullRelease;
            return Task.CompletedTask;
        }
    }
}
