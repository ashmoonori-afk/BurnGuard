using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.RegularExpressions;
using System.Web.Script.Serialization;

namespace BurnGuard.ProcessHost
{
    internal static class Program
    {
        private const uint KillOnJobClose = 0x00002000;
        private const uint CreateSuspended = 0x00000004;
        private const uint CreateUnicodeEnvironment = 0x00000400;
        private const uint StartfUseStdHandles = 0x00000100;
        private const uint DuplicateSameAccess = 0x00000002;
        private const uint JobObjectQuery = 0x0004;
        private const uint JobObjectTerminate = 0x0008;
        private const uint Synchronize = 0x00100000;
        private const uint Infinite = 0xffffffff;
        private const uint WaitObject0 = 0;
        private const uint JobObjectMsgActiveProcessZero = 4;
        private const uint ControlledTerminationCode = 143;
        private static readonly Regex TokenPattern = new Regex("^[a-f0-9]{32}$", RegexOptions.CultureInvariant);

        private enum HostExit
        {
            InvalidArguments = 200,
            NativeFailure = 201,
            AssignmentFailure = 202,
            ResumeFailure = 203,
            CleanupTimeout = 204,
            CleanupIncomplete = 205,
            ReceiptFailure = 206,
        }

        private sealed class HostFailure : Exception
        {
            internal readonly HostExit Exit;
            internal readonly string Code;
            internal HostFailure(HostExit exit, string code) { Exit = exit; Code = code; }
        }

        private static int Main(string[] args)
        {
            try
            {
                var parsed = Parse(args);
                return parsed.Mode == "launch" ? Launch(parsed) : Terminate(parsed);
            }
            catch (HostFailure failure)
            {
                Console.Error.WriteLine("[burnguard-process-host] " + failure.Code);
                return (int)failure.Exit;
            }
            catch
            {
                Console.Error.WriteLine("[burnguard-process-host] unexpected_failure");
                return (int)HostExit.NativeFailure;
            }
        }

        private static int Launch(Arguments args)
        {
            IntPtr job = IntPtr.Zero, completionPort = IntPtr.Zero, zero = IntPtr.Zero;
            IntPtr stdin = IntPtr.Zero, stdout = IntPtr.Zero, stderr = IntPtr.Zero;
            ProcessInformation process = default(ProcessInformation);
            try
            {
                zero = Native.CreateEvent(IntPtr.Zero, true, false, ZeroEventName(args.Job));
                if (zero == IntPtr.Zero) Fail(HostExit.NativeFailure, "create_zero_event_failed");
                job = Native.CreateJobObject(IntPtr.Zero, JobName(args.Job));
                var jobError = Marshal.GetLastWin32Error();
                if (job == IntPtr.Zero) Fail(HostExit.NativeFailure, "create_job_failed");
                if (jobError == 183) Fail(HostExit.NativeFailure, "job_already_exists");
                SetJobInformation(job, 9, new ExtendedLimitInformation { Basic = new BasicLimitInformation { LimitFlags = KillOnJobClose } }, "configure_job_failed");

                completionPort = Native.CreateIoCompletionPort(new IntPtr(-1), IntPtr.Zero, UIntPtr.Zero, 1);
                if (completionPort == IntPtr.Zero) Fail(HostExit.NativeFailure, "create_completion_port_failed");
                SetJobInformation(job, 7, new AssociateCompletionPort { CompletionKey = new IntPtr(1), CompletionPort = completionPort }, "associate_completion_port_failed");

                stdin = DuplicateStandardHandle(-10);
                stdout = DuplicateStandardHandle(-11);
                stderr = DuplicateStandardHandle(-12);
                var startup = new StartupInfo { Size = Marshal.SizeOf(typeof(StartupInfo)), Flags = StartfUseStdHandles, StandardInput = stdin, StandardOutput = stdout, StandardError = stderr };
                var invocation = BuildInvocation(args.Target);
                if (!Native.CreateProcess(invocation.Application, new StringBuilder(invocation.CommandLine), IntPtr.Zero, IntPtr.Zero, true, CreateSuspended | CreateUnicodeEnvironment, IntPtr.Zero, null, ref startup, out process))
                    Fail(HostExit.NativeFailure, "create_process_failed");
                if (!Native.AssignProcessToJobObject(job, process.Process))
                {
                    Native.TerminateProcess(process.Process, ControlledTerminationCode);
                    Fail(HostExit.AssignmentFailure, "assign_job_failed");
                }
                if (Native.ResumeThread(process.Thread) == uint.MaxValue)
                {
                    Native.TerminateJobObject(job, ControlledTerminationCode);
                    Fail(HostExit.ResumeFailure, "resume_failed");
                }

                WriteReceipt(args.Receipt, "{\"schema_version\":1,\"operation\":\"launch\",\"state\":\"running\",\"job_token\":\"" + args.Job + "\",\"host_pid\":" + Native.GetCurrentProcessId() + ",\"target_pid\":" + process.ProcessId + ",\"active_processes\":" + ActiveProcesses(job) + "}");
                if (Native.WaitForSingleObject(process.Process, Infinite) != WaitObject0) Fail(HostExit.NativeFailure, "target_wait_failed");
                uint targetExit;
                if (!Native.GetExitCodeProcess(process.Process, out targetExit)) Fail(HostExit.NativeFailure, "target_exit_failed");
                if (ActiveProcesses(job) != 0 && !Native.TerminateJobObject(job, targetExit)) Fail(HostExit.NativeFailure, "terminate_descendants_failed");
                WaitForActiveZero(completionPort, zero, job, args.TimeoutMs);
                WriteReceipt(args.Receipt, "{\"schema_version\":1,\"operation\":\"launch\",\"state\":\"exited\",\"job_token\":\"" + args.Job + "\",\"host_pid\":" + Native.GetCurrentProcessId() + ",\"target_pid\":" + process.ProcessId + ",\"target_exit_code\":" + targetExit + ",\"active_processes\":0}");
                return targetExit > 255 ? 255 : (int)targetExit;
            }
            finally
            {
                Close(process.Thread); Close(process.Process);
                Close(stdin); Close(stdout); Close(stderr);
                Close(completionPort); Close(job); Close(zero);
            }
        }

        private static int Terminate(Arguments args)
        {
            IntPtr zero = IntPtr.Zero, job = IntPtr.Zero, launcher = IntPtr.Zero;
            var members = new List<IntPtr>();
            try
            {
                var authority = ReadLaunchAuthority(args);
                job = Native.OpenJobObject(JobObjectQuery | JobObjectTerminate, false, JobName(args.Job));
                zero = Native.OpenEvent(Synchronize, false, ZeroEventName(args.Job));
                launcher = Native.OpenProcess(Synchronize, false, authority.HostPid);
                if (job == IntPtr.Zero || zero == IntPtr.Zero || launcher == IntPtr.Zero) Fail(HostExit.NativeFailure, "open_job_authority_failed");
                members.AddRange(OpenJobProcesses(job));
#if PROCESS_HOST_QA
                QaHandshake.SignalControlOpened(JobName(args.Job), Synchronize, WaitObject0);
#endif
                if (!Native.TerminateJobObject(job, ControlledTerminationCode)) Fail(HostExit.NativeFailure, "terminate_job_failed");

                var watch = Stopwatch.StartNew();
                var handles = new[] { zero, launcher };
                var wait = Native.WaitForMultipleObjects((uint)handles.Length, handles, false, (uint)args.TimeoutMs);
                if (wait == WaitObject0 + 1 && ActiveProcesses(job) != 0) WaitForProcesses(members, watch, args.TimeoutMs);
                var active = ActiveProcesses(job);
                if (active != 0)
                {
                    if (wait == 0x00000102) Fail(HostExit.CleanupTimeout, "job_zero_timeout");
                    Fail(HostExit.CleanupIncomplete, "active_processes_nonzero");
                }
                WriteReceipt(args.Receipt, "{\"schema_version\":1,\"operation\":\"terminate\",\"state\":\"terminated\",\"job_token\":\"" + args.Job + "\",\"active_processes\":0}");
                return 0;
            }
            finally
            {
                foreach (var member in members) Close(member);
                Close(launcher); Close(job); Close(zero);
            }
        }

        private static LaunchAuthority ReadLaunchAuthority(Arguments args)
        {
            try
            {
                var path = Path.Combine(Path.GetDirectoryName(args.Receipt), "launch.json");
                var value = new JavaScriptSerializer().Deserialize<Dictionary<string, object>>(File.ReadAllText(path));
                if (Convert.ToInt32(value["schema_version"]) != 1 || (string)value["operation"] != "launch" || (string)value["state"] != "running" || (string)value["job_token"] != args.Job)
                    Fail(HostExit.NativeFailure, "invalid_launch_receipt");
                var hostPid = Convert.ToUInt32(value["host_pid"]);
                if (hostPid == 0) Fail(HostExit.NativeFailure, "invalid_launch_receipt");
                return new LaunchAuthority { HostPid = hostPid };
            }
            catch (HostFailure) { throw; }
            catch { Fail(HostExit.NativeFailure, "invalid_launch_receipt"); return null; }
        }

        private static IEnumerable<IntPtr> OpenJobProcesses(IntPtr job)
        {
            const int maximum = 4096;
            var size = 8 + maximum * IntPtr.Size;
            var buffer = Marshal.AllocHGlobal(size);
            var result = new List<IntPtr>();
            try
            {
                uint returned;
                if (!Native.QueryInformationJobObject(job, 3, buffer, (uint)size, out returned)) Fail(HostExit.NativeFailure, "query_job_processes_failed");
                var listed = Marshal.ReadInt32(buffer, 4);
                if (listed < 0 || listed > maximum) Fail(HostExit.NativeFailure, "job_process_limit_exceeded");
                for (var index = 0; index < listed; index++)
                {
                    var pid = unchecked((uint)Marshal.ReadInt64(buffer, 8 + index * IntPtr.Size));
                    var handle = Native.OpenProcess(Synchronize, false, pid);
                    if (handle != IntPtr.Zero) result.Add(handle);
                    else if (Marshal.GetLastWin32Error() != 87) Fail(HostExit.NativeFailure, "open_job_process_failed");
                }
                return result;
            }
            finally { Marshal.FreeHGlobal(buffer); }
        }

        private static void WaitForProcesses(IEnumerable<IntPtr> processes, Stopwatch watch, int timeoutMs)
        {
            foreach (var process in processes)
            {
                var remaining = timeoutMs - (int)watch.ElapsedMilliseconds;
                if (remaining <= 0 || Native.WaitForSingleObject(process, (uint)remaining) != WaitObject0) Fail(HostExit.CleanupTimeout, "job_process_timeout");
            }
        }

        private static void WaitForActiveZero(IntPtr completionPort, IntPtr zeroEvent, IntPtr job, int timeoutMs)
        {
            var watch = Stopwatch.StartNew();
            while (true)
            {
                var remaining = timeoutMs - (int)watch.ElapsedMilliseconds;
                if (remaining <= 0) Fail(HostExit.CleanupTimeout, "job_zero_timeout");
                uint message;
                UIntPtr key;
                IntPtr overlapped;
                if (!Native.GetQueuedCompletionStatus(completionPort, out message, out key, out overlapped, (uint)remaining))
                    Fail(HostExit.CleanupTimeout, "job_completion_timeout");
                if (message != JobObjectMsgActiveProcessZero) continue;
                if (!Native.SetEvent(zeroEvent)) Fail(HostExit.NativeFailure, "zero_event_failed");
                if (ActiveProcesses(job) != 0) Fail(HostExit.CleanupIncomplete, "active_processes_nonzero");
                return;
            }
        }

        private static uint ActiveProcesses(IntPtr job)
        {
            var size = Marshal.SizeOf(typeof(BasicAccountingInformation));
            var buffer = Marshal.AllocHGlobal(size);
            try
            {
                uint returned;
                if (!Native.QueryInformationJobObject(job, 1, buffer, (uint)size, out returned) || returned < (uint)size)
                    Fail(HostExit.NativeFailure, "query_job_failed");
                return ((BasicAccountingInformation)Marshal.PtrToStructure(buffer, typeof(BasicAccountingInformation))).ActiveProcesses;
            }
            finally { Marshal.FreeHGlobal(buffer); }
        }

        private static IntPtr DuplicateStandardHandle(int identifier)
        {
            var source = Native.GetStdHandle(identifier);
            if (source == IntPtr.Zero || source == new IntPtr(-1)) Fail(HostExit.NativeFailure, "standard_handle_missing");
            IntPtr duplicate;
            if (!Native.DuplicateHandle(Native.GetCurrentProcess(), source, Native.GetCurrentProcess(), out duplicate, 0, true, DuplicateSameAccess))
                Fail(HostExit.NativeFailure, "standard_handle_duplicate_failed");
            return duplicate;
        }

        private static void SetJobInformation<T>(IntPtr job, int informationClass, T value, string error) where T : struct
        {
            var size = Marshal.SizeOf(typeof(T));
            var buffer = Marshal.AllocHGlobal(size);
            try
            {
                Marshal.StructureToPtr(value, buffer, false);
                if (!Native.SetInformationJobObject(job, informationClass, buffer, (uint)size)) Fail(HostExit.NativeFailure, error);
            }
            finally { Marshal.FreeHGlobal(buffer); }
        }

        private static void WriteReceipt(string path, string json)
        {
            try
            {
                var temporary = path + ".tmp-" + Native.GetCurrentProcessId();
                File.WriteAllText(temporary, json, new UTF8Encoding(false));
                if (File.Exists(path)) File.Replace(temporary, path, null);
                else File.Move(temporary, path);
            }
            catch { Fail(HostExit.ReceiptFailure, "receipt_write_failed"); }
        }

        private static Arguments Parse(string[] args)
        {
            if (args.Length < 5 || (args[0] != "launch" && args[0] != "terminate")) Fail(HostExit.InvalidArguments, "invalid_arguments");
            var parsed = new Arguments { Mode = args[0], TimeoutMs = 2_000 };
            var separator = -1;
            for (var index = 1; index < args.Length; index++)
            {
                if (args[index] == "--") { separator = index; break; }
                if (index + 1 >= args.Length) Fail(HostExit.InvalidArguments, "invalid_arguments");
                var value = args[++index];
                if (args[index - 1] == "--job" && parsed.Job == null) parsed.Job = value;
                else if (args[index - 1] == "--receipt" && parsed.Receipt == null) parsed.Receipt = value;
                else if (args[index - 1] == "--timeout-ms" && parsed.Mode == "terminate" && !parsed.TimeoutSet && int.TryParse(value, out var timeout) && timeout > 0 && timeout <= 30_000) { parsed.TimeoutMs = timeout; parsed.TimeoutSet = true; }
                else Fail(HostExit.InvalidArguments, "invalid_arguments");
            }
            if (parsed.Job == null || !TokenPattern.IsMatch(parsed.Job) || parsed.Receipt == null || !Path.IsPathRooted(parsed.Receipt) || !Directory.Exists(Path.GetDirectoryName(parsed.Receipt)))
                Fail(HostExit.InvalidArguments, "invalid_arguments");
            if (parsed.Mode == "terminate")
            {
                if (separator != -1 || !parsed.TimeoutSet) Fail(HostExit.InvalidArguments, "invalid_arguments");
                parsed.Target = new string[0];
                return parsed;
            }
            if (separator < 0 || separator == args.Length - 1) Fail(HostExit.InvalidArguments, "invalid_arguments");
            parsed.Target = new string[args.Length - separator - 1];
            Array.Copy(args, separator + 1, parsed.Target, 0, parsed.Target.Length);
            return parsed;
        }

        // Batch command construction is adapted under Apache-2.0 from Rust 1.90.0 std:
        // library/std/src/sys/args/windows.rs make_bat_command_line/append_bat_arg.
        // Source: https://github.com/rust-lang/rust/blob/1.90.0/library/std/src/sys/args/windows.rs
        // Copyright (c) The Rust Project Contributors. See the repository NOTICE.
        private static Invocation BuildInvocation(IReadOnlyList<string> target)
        {
            var extension = Path.GetExtension(target[0]);
            if (!extension.Equals(".cmd", StringComparison.OrdinalIgnoreCase) && !extension.Equals(".bat", StringComparison.OrdinalIgnoreCase))
                return new Invocation { Application = target[0], CommandLine = BuildCommandLine(target) };
            var systemCommand = Path.Combine(Environment.SystemDirectory, "cmd.exe");
            var configured = Environment.GetEnvironmentVariable("ComSpec");
            var command = !string.IsNullOrEmpty(configured) && Path.IsPathRooted(configured) && string.Equals(Path.GetFullPath(configured), systemCommand, StringComparison.OrdinalIgnoreCase)
                ? configured
                : systemCommand;
            if (target[0].IndexOf('"') >= 0 || target[0].EndsWith("\\", StringComparison.Ordinal)) Fail(HostExit.InvalidArguments, "invalid_batch_target");
            var batch = new StringBuilder(QuoteArgument(command) + " /e:ON /v:OFF /d /c \"\"");
            batch.Append(target[0]);
            batch.Append('"');
            for (var index = 1; index < target.Count; index++)
            {
                batch.Append(' ');
                batch.Append(QuoteBatchArgument(target[index]));
            }
            batch.Append('"');
            return new Invocation { Application = command, CommandLine = batch.ToString() };
        }

        private static string QuoteBatchArgument(string value)
        {
            if (value.IndexOfAny(new[] { '\0', '\r', '\n' }) >= 0) Fail(HostExit.InvalidArguments, "invalid_batch_argument");
            var quote = value.Length == 0 || value.EndsWith("\\", StringComparison.Ordinal);
            const string safe = "#$*+-./:?@\\_";
            foreach (var character in value)
            {
                if (character < 0x20 || character < 0x7f && !char.IsLetterOrDigit(character) && safe.IndexOf(character) < 0) quote = true;
            }
            var result = new StringBuilder();
            if (quote) result.Append('"');
            var slashes = 0;
            foreach (var character in value)
            {
                if (character == '\\') { slashes++; continue; }
                if (character == '"') { result.Append('\\', slashes * 2); result.Append("\"\""); }
                else
                {
                    result.Append('\\', slashes);
                    if (character == '%') result.Append("%%cd:~,");
                    result.Append(character);
                }
                slashes = 0;
            }
            result.Append('\\', quote ? slashes * 2 : slashes);
            if (quote) result.Append('"');
            return result.ToString();
        }

        private static string BuildCommandLine(IReadOnlyList<string> arguments)
        {
            var result = new StringBuilder();
            for (var index = 0; index < arguments.Count; index++)
            {
                if (index > 0) result.Append(' ');
                result.Append(QuoteArgument(arguments[index]));
            }
            return result.ToString();
        }

        private static string QuoteArgument(string value)
        {
            if (value.Length > 0 && value.IndexOfAny(new[] { ' ', '\t', '\n', '\v', '"' }) < 0) return value;
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
        private static string ZeroEventName(string token) { return JobName(token) + ".Zero"; }
        private static void Close(IntPtr handle) { if (handle != IntPtr.Zero && handle != new IntPtr(-1)) Native.CloseHandle(handle); }
        private static void Fail(HostExit exit, string code) { throw new HostFailure(exit, code); }

        private sealed class Arguments { internal string Mode, Job, Receipt; internal string[] Target; internal int TimeoutMs; internal bool TimeoutSet; }
        private sealed class LaunchAuthority { internal uint HostPid; }
        private sealed class Invocation { internal string Application, CommandLine; }
        [StructLayout(LayoutKind.Sequential)] private struct BasicLimitInformation { internal long PerProcessUserTimeLimit, PerJobUserTimeLimit; internal uint LimitFlags; internal UIntPtr MinimumWorkingSetSize, MaximumWorkingSetSize; internal uint ActiveProcessLimit; internal UIntPtr Affinity; internal uint PriorityClass, SchedulingClass; }
        [StructLayout(LayoutKind.Sequential)] private struct IoCounters { internal ulong ReadOperations, WriteOperations, OtherOperations, ReadBytes, WriteBytes, OtherBytes; }
        [StructLayout(LayoutKind.Sequential)] private struct ExtendedLimitInformation { internal BasicLimitInformation Basic; internal IoCounters Io; internal UIntPtr ProcessMemoryLimit, JobMemoryLimit, PeakProcessMemoryUsed, PeakJobMemoryUsed; }
        [StructLayout(LayoutKind.Sequential)] private struct AssociateCompletionPort { internal IntPtr CompletionKey, CompletionPort; }
        [StructLayout(LayoutKind.Sequential)] private struct BasicAccountingInformation { internal long TotalUserTime, TotalKernelTime, ThisPeriodTotalUserTime, ThisPeriodTotalKernelTime; internal uint TotalPageFaultCount, TotalProcesses, ActiveProcesses, TotalTerminatedProcesses; }
        [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)] private struct StartupInfo { internal int Size; internal string Reserved, Desktop, Title; internal uint X, Y, XSize, YSize, XCountChars, YCountChars, FillAttribute, Flags; internal short ShowWindow, Reserved2Size; internal IntPtr Reserved2, StandardInput, StandardOutput, StandardError; }
        [StructLayout(LayoutKind.Sequential)] private struct ProcessInformation { internal IntPtr Process, Thread; internal uint ProcessId, ThreadId; }

        private static class Native
        {
            [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] internal static extern IntPtr CreateJobObject(IntPtr attributes, string name);
            [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] internal static extern IntPtr OpenJobObject(uint access, bool inherit, string name);
            [DllImport("kernel32.dll", SetLastError = true)] internal static extern bool SetInformationJobObject(IntPtr job, int informationClass, IntPtr information, uint length);
            [DllImport("kernel32.dll", SetLastError = true)] internal static extern bool QueryInformationJobObject(IntPtr job, int informationClass, IntPtr information, uint length, out uint returnedLength);
            [DllImport("kernel32.dll", SetLastError = true)] internal static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);
            [DllImport("kernel32.dll", SetLastError = true)] internal static extern bool TerminateJobObject(IntPtr job, uint exitCode);
            [DllImport("kernel32.dll", SetLastError = true)] internal static extern IntPtr CreateIoCompletionPort(IntPtr file, IntPtr existingPort, UIntPtr completionKey, uint threads);
            [DllImport("kernel32.dll", SetLastError = true)] internal static extern bool GetQueuedCompletionStatus(IntPtr port, out uint bytes, out UIntPtr completionKey, out IntPtr overlapped, uint milliseconds);
            [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] internal static extern IntPtr CreateEvent(IntPtr attributes, bool manualReset, bool initialState, string name);
            [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] internal static extern IntPtr OpenEvent(uint access, bool inherit, string name);
            [DllImport("kernel32.dll", SetLastError = true)] internal static extern IntPtr OpenProcess(uint access, bool inherit, uint processId);
            [DllImport("kernel32.dll", SetLastError = true)] internal static extern bool SetEvent(IntPtr handle);
            [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] internal static extern bool CreateProcess(string applicationName, StringBuilder commandLine, IntPtr processAttributes, IntPtr threadAttributes, bool inheritHandles, uint creationFlags, IntPtr environment, string currentDirectory, ref StartupInfo startup, out ProcessInformation processInformation);
            [DllImport("kernel32.dll", SetLastError = true)] internal static extern uint ResumeThread(IntPtr thread);
            [DllImport("kernel32.dll", SetLastError = true)] internal static extern bool TerminateProcess(IntPtr process, uint exitCode);
            [DllImport("kernel32.dll", SetLastError = true)] internal static extern uint WaitForSingleObject(IntPtr handle, uint milliseconds);
            [DllImport("kernel32.dll", SetLastError = true)] internal static extern uint WaitForMultipleObjects(uint count, IntPtr[] handles, bool waitAll, uint milliseconds);
            [DllImport("kernel32.dll", SetLastError = true)] internal static extern bool GetExitCodeProcess(IntPtr process, out uint exitCode);
            [DllImport("kernel32.dll", SetLastError = true)] internal static extern IntPtr GetStdHandle(int identifier);
            [DllImport("kernel32.dll")] internal static extern IntPtr GetCurrentProcess();
            [DllImport("kernel32.dll")] internal static extern uint GetCurrentProcessId();
            [DllImport("kernel32.dll", SetLastError = true)] internal static extern bool DuplicateHandle(IntPtr sourceProcess, IntPtr source, IntPtr targetProcess, out IntPtr target, uint access, bool inherit, uint options);
            [DllImport("kernel32.dll", SetLastError = true)] internal static extern bool CloseHandle(IntPtr handle);
        }
    }
}
