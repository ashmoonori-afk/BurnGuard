import AppKit
import Foundation
import WebKit

private let smokeTestArguments = ["--smoke-test", "--smoke-report"]

final class BurnGuardAppDelegate: NSObject, NSApplicationDelegate, NSWindowDelegate, WKNavigationDelegate {
    private var window: NSWindow!
    private var webView: WKWebView!
    private var service: Process?
    private var serviceInput: Pipe?
    private var serviceOutput: Pipe?
    private var outputBuffer = Data()
    private var origin: URL?
    private var smokeReportPath: String?
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
        guard let url = navigationAction.request.url, isAppURL(url) else {
            decisionHandler(.cancel)
            return
        }
        decisionHandler(.allow)
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        guard smokeReportPath != nil else { return }
        webView.callAsyncJavaScript(
            """
            const ready = () => {
                const root = document.getElementById("root");
                return root && root.innerText.trim().length >= 40;
            };
            if (ready()) {
                return {title: document.title, bodyTextLength: document.body?.innerText?.length ?? 0};
            }
            return await new Promise((resolve, reject) => {
                const observer = new MutationObserver(() => {
                    if (!ready()) return;
                    observer.disconnect();
                    resolve({title: document.title, bodyTextLength: document.body?.innerText?.length ?? 0});
                });
                observer.observe(document.documentElement, {subtree: true, childList: true, characterData: true});
                window.setTimeout(() => {
                    observer.disconnect();
                    reject(new Error("BurnGuard 기본 화면이 준비되지 않았습니다."));
                }, 60000);
            });
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
                guard let reportPath = self.smokeReportPath else { return }
                self.writeReport([
                    "nativeWindowVisible": self.window.isVisible,
                    "windowTitle": self.window.title,
                    "pageTitle": pageTitle,
                    "bodyTextLength": bodyTextLength,
                    "backendUrl": self.origin?.absoluteString ?? "",
                ], to: reportPath)
                self.shutdown()
            case .failure(let error):
                self.fail(error.localizedDescription)
            }
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
        environment["BG_THUMBNAIL_CACHE_ONLY"] = "1"
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
                  protocolVersion == 1,
                  let urlString = message["url"] as? String,
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
