using System;
using System.Runtime.InteropServices;

namespace BurnGuard.ProcessHost
{
    internal static class QaHandshake
    {
        internal static void SignalControlOpened(string jobName, uint synchronize, uint waitObject0)
        {
            IntPtr opened = IntPtr.Zero, continuation = IntPtr.Zero;
            try
            {
                opened = Native.OpenEvent(0x0002, false, jobName + ".QaOpened");
                if (opened == IntPtr.Zero) throw new InvalidOperationException("QA opened event is missing");
                continuation = Native.OpenEvent(synchronize, false, jobName + ".QaContinue");
                if (continuation == IntPtr.Zero || !Native.SetEvent(opened)) throw new InvalidOperationException("QA handshake failed");
                if (Native.WaitForSingleObject(continuation, 2_000) != waitObject0) throw new TimeoutException("QA handshake timed out");
            }
            finally
            {
                if (opened != IntPtr.Zero) Native.CloseHandle(opened);
                if (continuation != IntPtr.Zero) Native.CloseHandle(continuation);
            }
        }

        private static class Native
        {
            [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] internal static extern IntPtr OpenEvent(uint access, bool inherit, string name);
            [DllImport("kernel32.dll", SetLastError = true)] internal static extern bool SetEvent(IntPtr handle);
            [DllImport("kernel32.dll", SetLastError = true)] internal static extern uint WaitForSingleObject(IntPtr handle, uint milliseconds);
            [DllImport("kernel32.dll", SetLastError = true)] internal static extern bool CloseHandle(IntPtr handle);
        }
    }
}
