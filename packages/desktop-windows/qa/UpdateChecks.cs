using System;
using System.Reflection;
using System.Threading;
using System.Threading.Tasks;
using System.Windows.Forms;
using Velopack;
using Velopack.Sources;

// Runs native update UI logic without opening a window, backend, profile, or network connection.
internal static class UpdateChecks
{
    private static readonly Type Window = Assembly.Load("BurnGuard").GetType("BurnGuard.Desktop.DesktopWindow", true);
    private const BindingFlags Fields = BindingFlags.Instance | BindingFlags.NonPublic;
    private static object Field(Form form, string name) => Window.GetField(name, Fields).GetValue(form);
    private static void Assert(bool value, string description) { if (!value) throw new Exception(description); }

    [STAThread]
    private static void Main()
    {
        VelopackApp.Build().Run();
        Check(new FakeUpdates { Installed = false }, null, "설치 패키지", false, 0, 0);
        Check(new FakeUpdates(), "isolated-smoke.json", "대기 중", false, 0, 0);
        Check(new FakeUpdates(), null, "최신 버전", false, 1, 0);
        Check(new FakeUpdates { Offline = true }, null, "확인하지 못했습니다", false, 1, 0);
        Check(new FakeUpdates { Available = true }, null, "준비 완료", true, 1, 1);
        Check(new FakeUpdates { Available = true, DownloadFails = true }, null, "확인하지 못했습니다", false, 1, 1);
        Console.WriteLine("PASS: portable, smoke, current, offline, staged/recheck, failed download; no live update applied.");
    }

    private static void Check(FakeUpdates updates, string report, string expected, bool staged, int checks, int downloads)
    {
        using (var form = (Form)Activator.CreateInstance(Window, Fields, null, new object[] { "update-qa", (uint)0, report }, null))
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
