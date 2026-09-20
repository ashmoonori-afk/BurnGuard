using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;
using System.Web.Script.Serialization;

internal static class ProcessHostChecks
{
    private const uint Synchronize = 0x00100000;
    private const uint WaitObject0 = 0;
    private const uint WaitTimeout = 0x00000102;
    private static readonly string Self = Process.GetCurrentProcess().MainModule.FileName;

    private static int Main(string[] args)
    {
        if (args.Length > 0) return RunFixture(args);
        if (Environment.OSVersion.Platform != PlatformID.Win32NT) throw new InvalidOperationException("Windows is required");
        var helper = Environment.GetEnvironmentVariable("BG_WINDOWS_PROCESS_HOST");
        var qaHelper = Environment.GetEnvironmentVariable("BG_WINDOWS_PROCESS_HOST_QA");
        if (string.IsNullOrEmpty(helper) || !File.Exists(helper)) throw new InvalidOperationException("BG_WINDOWS_PROCESS_HOST is required");
        if (string.IsNullOrEmpty(qaHelper) || !File.Exists(qaHelper)) throw new InvalidOperationException("BG_WINDOWS_PROCESS_HOST_QA is required");
        if (string.Equals(Path.GetFullPath(helper), Path.GetFullPath(qaHelper), StringComparison.OrdinalIgnoreCase)) throw new InvalidOperationException("Product and QA process hosts must be distinct");
        ArgumentContract(helper);
        RootExitReapsChild(helper);
        LauncherDeathDuringTerminate(qaHelper);
        Console.WriteLine("PASS: root-exit cleanup and launcher-death termination preserve unrelated sentinels");
        return 0;
    }

    private static int RunFixture(string[] args)
    {
        if (args.Length > 0 && args[0] == "capture")
        {
            for (var index = 1; index < args.Length; index++) Console.WriteLine("arg:" + Convert.ToBase64String(System.Text.Encoding.UTF8.GetBytes(args[index])));
            return 0;
        }
        if (args.Length != 2) return 90;
        if (args[0] == "child")
        {
            Console.WriteLine(Process.GetCurrentProcess().Id);
            Console.Out.Flush();
            using (var release = EventWaitHandle.OpenExisting(args[1])) release.WaitOne();
            return 0;
        }
        if (args[0] == "tree-exit" || args[0] == "tree-live")
        {
            using (var child = Start(Self, "child " + Quote(args[1]), true))
            {
                var line = ReadLine(child, 5_000);
                Console.WriteLine("child:" + line);
                Console.Out.Flush();
            }
            if (args[0] == "tree-exit") return 23;
            using (var release = EventWaitHandle.OpenExisting(args[1])) release.WaitOne();
            return 0;
        }
        return 91;
    }

    private static void ArgumentContract(string helper)
    {
        using (var fixture = new Fixture())
        {
            var injected = Path.Combine(fixture.Root, "injected.txt");
            var arguments = new[] { "plain", "space value", "quote\"value", "&|<>()^!%PATH%", "\" & echo injected>" + injected + " & rem" };
            var commandShim = Path.Combine(fixture.Root, "provider shim.cmd");
            var batchShim = Path.Combine(fixture.Root, "provider shim.bat");
            var shim = "@echo off\r\n\"%~dp0ProcessHostChecks.exe\" capture %*\r\n";
            File.WriteAllText(commandShim, shim);
            File.WriteAllText(batchShim, shim);
            File.Copy(Self, Path.Combine(fixture.Root, "ProcessHostChecks.exe"));
            VerifyArguments(helper, fixture.Root, Self, arguments, true);
            VerifyArguments(helper, fixture.Root, commandShim, arguments, false);
            VerifyArguments(helper, fixture.Root, batchShim, arguments, false);
            if (File.Exists(injected)) throw new Exception("batch argument escaped into command execution");
        }
    }

    private static void VerifyArguments(string helper, string root, string target, string[] arguments, bool directExecutable)
    {
        var token = Guid.NewGuid().ToString("N");
        var receipt = Path.Combine(root, token + ".json");
        var command = "launch --job " + token + " --receipt " + Quote(receipt) + " -- " + Quote(target);
        if (directExecutable) command += " capture";
        foreach (var argument in arguments) command += " " + Quote(argument);
        using (var host = Start(helper, command, true))
        {
            var watch = Stopwatch.StartNew();
            var output = host.StandardOutput.ReadToEndAsync();
            var error = host.StandardError.ReadToEndAsync();
            var exited = host.WaitForExit(5_000);
            var remaining = Math.Max(0, 5_000 - (int)watch.ElapsedMilliseconds);
            var streams = exited && Task.WaitAll(new Task[] { output, error }, remaining);
            var receiptText = File.Exists(receipt) ? File.ReadAllText(receipt) : "";
            WriteArgumentEvidence(target, arguments, exited ? host.ExitCode : (int?)null, output.IsCompleted ? output.Result : "", error.IsCompleted ? error.Result : "", receiptText);
            if (!exited || !streams) throw new Exception("argument fixture deadline: " + Path.GetExtension(target));
            if (host.ExitCode != 0) throw new Exception("argument fixture host exit: " + Path.GetExtension(target) + ":" + host.ExitCode);
            var lines = output.Result.Split(new[] { "\r\n", "\n" }, StringSplitOptions.RemoveEmptyEntries);
            Equal(lines.Length, arguments.Length, "argument count changed");
            for (var index = 0; index < arguments.Length; index++)
            {
                var expected = "arg:" + Convert.ToBase64String(System.Text.Encoding.UTF8.GetBytes(arguments[index]));
                Equal(lines[index], expected, "argument bytes changed at " + index);
            }
            ExactLaunch(Receipt(receipt), token, host.Id, 0);
        }
    }

    private static void RootExitReapsChild(string helper)
    {
        using (var fixture = new Fixture())
        using (var sentinel = Start(Self, "child " + Quote(fixture.SentinelEventName), true))
        {
            var sentinelPid = PositivePid(ReadLine(sentinel, 5_000));
            var token = Guid.NewGuid().ToString("N");
            var launch = Path.Combine(fixture.Root, "launch.json");
            using (var host = Start(helper, LaunchArguments(token, launch, "tree-exit", fixture.ChildEventName), true))
            {
                var childPid = ChildPid(ReadLine(host, 5_000));
                using (var childHandle = OpenRetainedProcess((uint)childPid))
                {
                    if (!host.WaitForExit(5_000)) throw new Exception("root-exit host deadline");
                    Equal(host.ExitCode, 23, "host must preserve target exit code");
                    var receipt = Receipt(launch);
                    ExactLaunch(receipt, token, host.Id, 23);
                    Signaled(childHandle, 5_000, "root-exit child survived job cleanup");
                    Present(sentinelPid, "unrelated sentinel was terminated");
                }
            }
            fixture.ReleaseSentinel();
            if (!sentinel.WaitForExit(5_000)) throw new Exception("sentinel exit deadline");
        }
    }

    private static void LauncherDeathDuringTerminate(string qaHelper)
    {
        using (var fixture = new Fixture())
        using (var sentinel = Start(Self, "child " + Quote(fixture.SentinelEventName), true))
        {
            var sentinelPid = PositivePid(ReadLine(sentinel, 5_000));
            var token = Guid.NewGuid().ToString("N");
            var launch = Path.Combine(fixture.Root, "launch.json");
            var terminate = Path.Combine(fixture.Root, "terminate.json");
            using (var receiptSignal = WatchFile(fixture.Root, "launch.json"))
            using (var opened = new EventWaitHandle(false, EventResetMode.ManualReset, JobName(token) + ".QaOpened"))
            using (var continuation = new EventWaitHandle(false, EventResetMode.ManualReset, JobName(token) + ".QaContinue"))
            using (var host = Start(qaHelper, LaunchArguments(token, launch, "tree-live", fixture.ChildEventName), true))
            {
                var childPid = ChildPid(ReadLine(host, 5_000));
                receiptSignal.Wait(5_000);
                var running = Receipt(launch);
                Equal((string)running["state"], "running", "launch receipt must be running before control");
                var targetPid = Convert.ToUInt32(running["target_pid"]);
                using (var targetHandle = OpenRetainedProcess(targetPid))
                using (var childHandle = OpenRetainedProcess((uint)childPid))
                using (var control = Start(qaHelper, "terminate --job " + token + " --receipt " + Quote(terminate) + " --timeout-ms 2000", false))
                {
                    if (!opened.WaitOne(2_000)) throw new Exception("control-open handshake deadline");
                    host.Kill();
                    if (!host.WaitForExit(2_000)) throw new Exception("launcher death deadline");
                    continuation.Set();
                    if (!control.WaitForExit(5_000)) throw new Exception("terminate helper deadline");
                    Equal(control.ExitCode, 0, "terminate helper failed after launcher death");
                    ExactTerminate(Receipt(terminate), token);
                    Signaled(targetHandle, 0, "target survived terminate receipt");
                    Signaled(childHandle, 0, "child survived terminate receipt");
                    Present(sentinelPid, "unrelated sentinel was terminated");
                }
            }
            fixture.ReleaseSentinel();
            if (!sentinel.WaitForExit(5_000)) throw new Exception("sentinel exit deadline");
        }
    }

    private static string LaunchArguments(string token, string receipt, string mode, string eventName) =>
        "launch --job " + token + " --receipt " + Quote(receipt) + " -- " + Quote(Self) + " " + mode + " " + Quote(eventName);

    private static void WriteArgumentEvidence(string target, string[] arguments, int? exitCode, string output, string error, string receipt)
    {
        var root = Environment.GetEnvironmentVariable("BG_WINDOWS_PROCESS_HOST_EVIDENCE");
        if (string.IsNullOrEmpty(root)) return;
        Directory.CreateDirectory(root);
        var extension = Path.GetExtension(target).TrimStart('.').ToLowerInvariant();
        if (extension != "cmd" && extension != "bat") extension = "exe";
        var encoded = new string[arguments.Length];
        for (var index = 0; index < arguments.Length; index++) encoded[index] = Convert.ToBase64String(System.Text.Encoding.UTF8.GetBytes(arguments[index]));
        var value = new Dictionary<string, object> {
            ["schema_version"] = 1,
            ["case"] = extension,
            ["arguments_base64"] = encoded,
            ["exit_code"] = exitCode,
            ["stdout"] = output,
            ["stderr"] = error,
            ["launch_receipt"] = receipt,
        };
        File.WriteAllText(Path.Combine(root, extension + ".json"), new JavaScriptSerializer().Serialize(value));
    }

    private static Process Start(string executable, string arguments, bool output)
    {
        var process = new Process { StartInfo = new ProcessStartInfo(executable, arguments) { UseShellExecute = false, CreateNoWindow = true, RedirectStandardOutput = output, RedirectStandardError = true } };
        if (!process.Start()) throw new Exception("fixture process did not start");
        return process;
    }

    private static string ReadLine(Process process, int timeoutMs)
    {
        var task = process.StandardOutput.ReadLineAsync();
        if (!task.Wait(timeoutMs) || string.IsNullOrEmpty(task.Result)) throw new Exception("fixture readiness deadline");
        return task.Result;
    }

    private static Dictionary<string, object> Receipt(string path) => new JavaScriptSerializer().Deserialize<Dictionary<string, object>>(File.ReadAllText(path));
    private static void ExactLaunch(Dictionary<string, object> value, string token, int hostPid, int exitCode)
    {
        Equal(Convert.ToInt32(value["schema_version"]), 1, "launch schema");
        Equal((string)value["operation"], "launch", "launch operation");
        Equal((string)value["state"], "exited", "launch state");
        Equal((string)value["job_token"], token, "launch token");
        Equal(Convert.ToInt32(value["host_pid"]), hostPid, "launch host pid");
        Equal(Convert.ToInt32(value["target_exit_code"]), exitCode, "target exit code");
        Equal(Convert.ToInt32(value["active_processes"]), 0, "launch active count");
    }
    private static void ExactTerminate(Dictionary<string, object> value, string token)
    {
        Equal(Convert.ToInt32(value["schema_version"]), 1, "terminate schema");
        Equal((string)value["operation"], "terminate", "terminate operation");
        Equal((string)value["state"], "terminated", "terminate state");
        Equal((string)value["job_token"], token, "terminate token");
        Equal(Convert.ToInt32(value["active_processes"]), 0, "terminate active count");
    }

    private static SafeProcessHandle OpenRetainedProcess(uint pid)
    {
        var handle = Native.OpenProcess(Synchronize, false, pid);
        if (handle == IntPtr.Zero) throw new Exception("could not retain process handle " + pid);
        return new SafeProcessHandle(handle);
    }
    private static void Signaled(SafeProcessHandle process, int timeoutMs, string message) { if (Native.WaitForSingleObject(process.Handle, (uint)timeoutMs) != WaitObject0) throw new Exception(message); }
    private static void Present(int pid, string message) { using (var handle = OpenRetainedProcess((uint)pid)) if (Native.WaitForSingleObject(handle.Handle, 0) != WaitTimeout) throw new Exception(message); }
    private static int PositivePid(string value) { if (!int.TryParse(value, out var pid) || pid <= 0) throw new Exception("invalid fixture pid"); return pid; }
    private static int ChildPid(string value) { var match = Regex.Match(value, "^child:(\\d+)$"); return match.Success ? PositivePid(match.Groups[1].Value) : throw new Exception("invalid child receipt"); }
    private static void Equal<T>(T actual, T expected, string message) { if (!EqualityComparer<T>.Default.Equals(actual, expected)) throw new Exception(message); }
    private static string Quote(string value)
    {
        var result = new StringBuilder("\"");
        var slashes = 0;
        foreach (var character in value)
        {
            if (character == '\\') { slashes++; continue; }
            if (character == '"') { result.Append('\\', slashes * 2 + 1); result.Append('"'); slashes = 0; continue; }
            result.Append('\\', slashes); slashes = 0; result.Append(character);
        }
        result.Append('\\', slashes * 2); result.Append('"');
        return result.ToString();
    }
    private static string JobName(string token) { return "Local\\BurnGuard.Owned." + token; }

    private sealed class Fixture : IDisposable
    {
        internal readonly string Root = Path.Combine(Path.GetTempPath(), "burnguard-process-host-" + Guid.NewGuid().ToString("N"));
        internal readonly string ChildEventName = "Local\\BurnGuard.Qa.Child." + Guid.NewGuid().ToString("N");
        internal readonly string SentinelEventName = "Local\\BurnGuard.Qa.Sentinel." + Guid.NewGuid().ToString("N");
        private readonly EventWaitHandle child, sentinel;
        internal Fixture() { Directory.CreateDirectory(Root); child = new EventWaitHandle(false, EventResetMode.ManualReset, ChildEventName); sentinel = new EventWaitHandle(false, EventResetMode.ManualReset, SentinelEventName); }
        internal void ReleaseSentinel() { sentinel.Set(); }
        public void Dispose() { child.Set(); sentinel.Set(); child.Dispose(); sentinel.Dispose(); Directory.Delete(Root, true); }
    }

    private sealed class FileSignal : IDisposable
    {
        private readonly FileSystemWatcher watcher;
        private readonly TaskCompletionSource<bool> signal = new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);
        internal FileSignal(string root, string name) { watcher = new FileSystemWatcher(root, name); watcher.Created += Seen; watcher.Changed += Seen; watcher.Renamed += Renamed; watcher.EnableRaisingEvents = true; }
        private void Seen(object sender, FileSystemEventArgs args) { signal.TrySetResult(true); }
        private void Renamed(object sender, RenamedEventArgs args) { signal.TrySetResult(true); }
        internal void Wait(int timeoutMs) { if (File.Exists(Path.Combine(watcher.Path, watcher.Filter))) return; if (!signal.Task.Wait(timeoutMs)) throw new Exception("receipt readiness deadline"); }
        public void Dispose() { watcher.Dispose(); }
    }
    private static FileSignal WatchFile(string root, string name) { return new FileSignal(root, name); }

    private sealed class SafeProcessHandle : IDisposable { internal readonly IntPtr Handle; internal SafeProcessHandle(IntPtr handle) { Handle = handle; } public void Dispose() { Native.CloseHandle(Handle); } }
    private static class Native
    {
        [DllImport("kernel32.dll", SetLastError = true)] internal static extern IntPtr OpenProcess(uint access, bool inherit, uint processId);
        [DllImport("kernel32.dll", SetLastError = true)] internal static extern uint WaitForSingleObject(IntPtr handle, uint milliseconds);
        [DllImport("kernel32.dll", SetLastError = true)] internal static extern bool CloseHandle(IntPtr handle);
    }
}
