import AppKit
import Foundation
import WebKit

private let smokeTestArguments = ["--smoke-test", "--smoke-report"]

final class BurnGuardAppDelegate: NSObject, NSApplicationDelegate, NSWindowDelegate, WKNavigationDelegate, WKDownloadDelegate {
    private var window: NSWindow!
    private var webView: WKWebView!
    private var service: Process?
    private var serviceInput: Pipe?
    private var serviceOutput: Pipe?
    private var outputBuffer = Data()
    private var origin: URL?
    private var smokeReportPath: String?
    private var smokePageReport: [String: Any]?
    private var smokeDownloadFinished = false
    private var smokeStarted = false
    private var smokeFinishing = false
    private var closing = false

    func applicationDidFinishLaunching(_ notification: Notification) {
        do {
            smokeReportPath = try parseArguments()
            try createWindow()
            try startService()
        } catch {
            fail(error.localizedDescription)
        }
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
        false
    }

    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
        if closing {
            return .terminateNow
        }
        shutdown()
        return .terminateLater
    }

    func windowWillClose(_ notification: Notification) {
        shutdown()
    }

    func webView(
        _ webView: WKWebView,
        decidePolicyFor navigationAction: WKNavigationAction,
        decisionHandler: @escaping (WKNavigationActionPolicy) -> Void
    ) {
        guard let url = navigationAction.request.url else {
            decisionHandler(.cancel)
            return
        }
        // Canvas documents remain opaque, sandboxed subframes; never allow this at the top level.
        if url.absoluteString == "about:srcdoc", navigationAction.targetFrame?.isMainFrame == false {
            decisionHandler(.allow)
            return
        }
        if navigationAction.shouldPerformDownload {
            let trustedSource = navigationAction.sourceFrame.isMainFrame &&
                navigationAction.sourceFrame.request.url.map(isAppURL) == true
            decisionHandler(trustedSource && isAppDownloadURL(url) ? .download : .cancel)
            return
        }
        decisionHandler(isAppURL(url) ? .allow : .cancel)
    }

    func webView(_ webView: WKWebView, navigationAction: WKNavigationAction, didBecome download: WKDownload) {
        download.delegate = self
    }

    func download(_ download: WKDownload, decideDestinationUsing response: URLResponse, suggestedFilename: String,
                  completionHandler: @escaping (URL?) -> Void) {
        if let reportPath = smokeReportPath {
            // Only the explicit diagnostic invocation may bypass user consent, inside its owned directory.
            completionHandler(URL(fileURLWithPath: reportPath).deletingLastPathComponent().appendingPathComponent("native-smoke-download.txt"))
            return
        }
        let panel = NSSavePanel()
        panel.nameFieldStringValue = URL(fileURLWithPath: suggestedFilename).lastPathComponent
        panel.beginSheetModal(for: window) { result in
            completionHandler(result == .OK ? panel.url : nil)
        }
    }

    func download(_ download: WKDownload, willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest,
                  decisionHandler: @escaping (WKDownload.RedirectPolicy) -> Void) {
        decisionHandler(request.url.map(isAppURL) == true ? .allow : .cancel)
    }

    func downloadDidFinish(_ download: WKDownload) {
        guard smokeReportPath != nil else { return }
        smokeDownloadFinished = true
        if smokePageReport != nil { finishSmoke() }
    }

    func download(_ download: WKDownload, didFailWithError error: Error, resumeData: Data?) {
        if (error as NSError).domain == NSURLErrorDomain && (error as NSError).code == NSURLErrorCancelled { return }
        if smokeReportPath != nil {
            fail("Native download failed.")
        } else {
            let alert = NSAlert()
            alert.messageText = "BurnGuard"
            alert.informativeText = "파일을 다운로드하지 못했습니다. 다시 시도해 주세요."
            alert.beginSheetModal(for: window)
        }
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        guard smokeReportPath != nil, !smokeStarted else { return }
        smokeStarted = true
        DispatchQueue.main.asyncAfter(deadline: .now() + 80) { [weak self] in
            guard let self, !self.closing else { return }
            self.finishSmoke()
        }
        webView.callAsyncJavaScript(
            """
            const ready = () => {
                const root = document.getElementById("root");
                return root && root.innerText.trim().length >= 40;
            };
            if (!ready()) await new Promise((resolve, reject) => {
                const observer = new MutationObserver(() => {
                    if (!ready()) return;
                    clearTimeout(timer);
                    observer.disconnect();
                    resolve();
                });
                observer.observe(document.documentElement, {subtree: true, childList: true, characterData: true});
                const timer = window.setTimeout(() => {
                    observer.disconnect();
                    reject(new Error("BurnGuard 기본 화면이 준비되지 않았습니다."));
                }, 60000);
            });
            const frame = document.createElement('iframe');
            frame.sandbox = 'allow-scripts';
            frame.title = 'Native canvas regression';
            frame.style = 'position:fixed;inset:80px;width:600px;height:240px;z-index:2147483647;background:white';
            const canvasReady = new Promise(resolve => {
                const finish = value => { clearTimeout(timer); window.removeEventListener('message', receive); resolve(value); };
                const receive = event => {
                    if (event.source === frame.contentWindow && event.origin === 'null' && event.data === 'burnguard-native-canvas-ready') finish(true);
                };
                const timer = window.setTimeout(() => finish(false), 10000);
                window.addEventListener('message', receive);
            });
            frame.srcdoc = '<!doctype html><body style="background:#e6f4ff;font:24px system-ui;padding:24px">Native sandboxed canvas loaded<script>parent.postMessage("burnguard-native-canvas-ready", "*")</script>';
            document.body.append(frame);
            const link = document.createElement('a');
            link.href = URL.createObjectURL(new Blob(['burnguard-native-download\\n'], {type: 'text/plain'}));
            link.download = 'native-smoke-download.txt';
            link.click();
            return {title: document.title, bodyTextLength: document.body?.innerText?.length ?? 0, canvasReady: await canvasReady};
            """,
            arguments: [:],
            in: nil,
            in: .page
        ) { [weak self] result in
            guard let self else { return }
            switch result {
            case .success(let value):
                guard let values = value as? [String: Any] else {
                    self.fail("BurnGuard 화면 상태를 확인할 수 없습니다.")
                    return
                }
                let pageTitle = values["title"] as? String ?? ""
                let bodyTextLength = values["bodyTextLength"] as? Int ?? 0
                self.smokePageReport = [
                    "nativeWindowVisible": self.window.isVisible,
                    "windowTitle": self.window.title,
                    "pageTitle": pageTitle,
                    "bodyTextLength": bodyTextLength,
                    "backendUrl": self.origin?.absoluteString ?? "",
                    "canvasReady": values["canvasReady"] as? Bool ?? false,
                    "backendPid": self.service?.processIdentifier ?? 0,
                ]
                if values["canvasReady"] as? Bool != true || self.smokeDownloadFinished { self.finishSmoke() }
            case .failure(let error):
                self.fail(error.localizedDescription)
            }
        }
    }

    private func finishSmoke() {
        guard let reportPath = smokeReportPath, !smokeFinishing else { return }
        smokeFinishing = true
        var report = smokePageReport ?? ["error": "Native smoke did not complete"]
        report["downloadCompleted"] = smokeDownloadFinished
        webView.takeSnapshot(with: nil) { [weak self] image, error in
            guard let self else { return }
            do {
                if let error { throw error }
                guard let tiff = image?.tiffRepresentation,
                      let png = NSBitmapImageRep(data: tiff)?.representation(using: .png, properties: [:]) else {
                    throw NSError(domain: "BurnGuard", code: 1)
                }
                try png.write(to: URL(fileURLWithPath: reportPath + ".png"), options: .atomic)
                report["snapshotCaptured"] = true
            } catch {
                report["snapshotCaptured"] = false
            }
            self.writeReport(report, to: reportPath)
            self.shutdown()
        }
    }

    func webView(
        _ webView: WKWebView,
        didFail navigation: WKNavigation!,
        withError error: Error
    ) {
        fail("BurnGuard 화면을 불러오지 못했습니다: \(error.localizedDescription)")
    }

    private func parseArguments() throws -> String? {
        let arguments = Array(CommandLine.arguments.dropFirst())
        if arguments.isEmpty {
            return nil
        }
        guard arguments.count == 3, Array(arguments.prefix(2)) == smokeTestArguments else {
            throw NSError(domain: "BurnGuard", code: 1, userInfo: [NSLocalizedDescriptionKey: "Supported diagnostic arguments: --smoke-test --smoke-report <absolute JSON path>."])
        }
        guard arguments[2].hasPrefix("/") else {
            throw NSError(domain: "BurnGuard", code: 1, userInfo: [NSLocalizedDescriptionKey: "The native smoke report path must be absolute."])
        }
        return arguments[2]
    }

    private func createWindow() throws {
        NSApp.setActivationPolicy(.regular)
        let configuration = WKWebViewConfiguration()
        if smokeReportPath != nil { configuration.websiteDataStore = .nonPersistent() }
        webView = WKWebView(frame: .zero, configuration: configuration)
        webView.navigationDelegate = self

        window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 1280, height: 850),
            styleMask: [.titled, .closable, .miniaturizable, .resizable],
            backing: .buffered,
            defer: false
        )
        window.title = "BurnGuard Design"
        window.minSize = NSSize(width: 900, height: 640)
        window.center()
        window.contentView = webView
        window.delegate = self
        window.isReleasedWhenClosed = false
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
    }

    private func startService() throws {
        let serviceURL = Bundle.main.bundleURL
            .appendingPathComponent("Contents/MacOS/burnguard-design")
        guard FileManager.default.isExecutableFile(atPath: serviceURL.path) else {
            throw NSError(domain: "BurnGuard", code: 1, userInfo: [NSLocalizedDescriptionKey: "Contents/MacOS/service/burnguard-service is missing or not executable."])
        }

        let input = Pipe()
        let output = Pipe()
        let errorOutput = Pipe()
        let process = Process()
        var environment = ProcessInfo.processInfo.environment
        environment["BG_DESKTOP"] = "1"
        environment["BG_NO_OPEN"] = "1"
        environment["BG_UPDATE_WAIT_PID"] = String(ProcessInfo.processInfo.processIdentifier)
        if environment["BG_PORT"] == nil {
            environment["BG_PORT"] = "14070"
        }
        process.executableURL = serviceURL
        process.standardInput = input
        process.standardOutput = output
        process.standardError = errorOutput
        process.environment = environment
        service = process
        serviceInput = input
        serviceOutput = output

        output.fileHandleForReading.readabilityHandler = { [weak self] handle in
            let data = handle.availableData
            guard !data.isEmpty else { return }
            DispatchQueue.main.async { self?.consumeServiceOutput(data) }
        }
        errorOutput.fileHandleForReading.readabilityHandler = { handle in
            _ = handle.availableData
        }
        process.terminationHandler = { [weak self] process in
            DispatchQueue.main.async {
                guard let self, !self.closing else { return }
                self.fail("BurnGuard 서버가 종료되었습니다 (code \(process.terminationStatus)).")
            }
        }
        try process.run()
        // Cold profiles seed and validate every bundled sample before readiness.
        DispatchQueue.main.asyncAfter(deadline: .now() + 300) { [weak self] in
            guard let self, !self.closing, self.origin == nil else { return }
            self.fail("BurnGuard 서버가 300초 안에 시작되지 않았습니다.")
        }
    }

    private func consumeServiceOutput(_ data: Data) {
        outputBuffer.append(data)
        while let newline = outputBuffer.firstIndex(of: 10) {
            let lineData = outputBuffer.prefix(upTo: newline)
            outputBuffer.removeSubrange(...newline)
            guard let line = String(data: lineData, encoding: .utf8),
                  line.hasPrefix("[burnguard-desktop] ") else { continue }
            let json = String(line.dropFirst("[burnguard-desktop] ".count))
            guard let data = json.data(using: .utf8),
                  let message = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                  let protocolVersion = message["protocol"] as? Int,
                  protocolVersion == 1 else {
                fail("BurnGuard 시작 응답을 확인할 수 없습니다.")
                return
            }
            if message["event"] as? String == "shutdown" {
                closing = true
                NSApp.terminate(nil)
                return
            }
            guard let urlString = message["url"] as? String,
                  let url = URL(string: urlString) else {
                fail("BurnGuard 시작 응답을 확인할 수 없습니다.")
                return
            }
            origin = url
            webView.load(URLRequest(url: url))
        }
    }

    private func isAppURL(_ url: URL) -> Bool {
        guard let origin, let host = url.host, let originHost = origin.host else {
            return false
        }
        return url.scheme == origin.scheme &&
            host == originHost &&
            url.port == origin.port &&
            url.user == nil
    }

    private func isAppDownloadURL(_ url: URL) -> Bool {
        if isAppURL(url) { return true }
        guard url.scheme == "blob", let blobURL = URL(string: String(url.absoluteString.dropFirst(5))) else { return false }
        return isAppURL(blobURL)
    }

    private func writeReport(_ report: [String: Any], to path: String) {
        guard let data = try? JSONSerialization.data(withJSONObject: report, options: [.prettyPrinted]) else {
            fail("네이티브 smoke 결과를 직렬화할 수 없습니다.")
            return
        }
        do {
            try data.write(to: URL(fileURLWithPath: path), options: .atomic)
        } catch {
            fail("네이티브 smoke 결과를 기록할 수 없습니다: \(error.localizedDescription)")
        }
    }

    private func fail(_ message: String) {
        if let reportPath = smokeReportPath {
            writeReport([
                "nativeWindowVisible": window?.isVisible ?? false,
                "windowTitle": window?.title ?? "",
                "pageTitle": "",
                "bodyTextLength": 0,
                "backendUrl": origin?.absoluteString ?? "",
                "error": message,
            ], to: reportPath)
        } else {
            let alert = NSAlert()
            alert.messageText = "BurnGuard"
            alert.informativeText = message
            alert.alertStyle = .warning
            alert.runModal()
        }
        shutdown()
    }

    private func shutdown() {
        guard !closing else { return }
        closing = true
        serviceOutput?.fileHandleForReading.readabilityHandler = nil
        serviceInput?.fileHandleForWriting.write(Data("shutdown\n".utf8))
        serviceInput?.fileHandleForWriting.closeFile()
        DispatchQueue.main.asyncAfter(deadline: .now() + 2) { [weak self] in
            guard let self else { return }
            if self.service?.isRunning == true {
                self.service?.terminate()
            }
            NSApp.terminate(nil)
        }
    }
}

let application = NSApplication.shared
let delegate = BurnGuardAppDelegate()
application.delegate = delegate
application.run()
