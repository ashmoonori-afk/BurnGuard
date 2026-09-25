import AppKit
import Foundation
import WebKit

private let smokeTestArguments = ["--smoke-test", "--smoke-report"]

final class BurnGuardAppDelegate: NSObject, NSApplicationDelegate, NSWindowDelegate, WKNavigationDelegate, WKUIDelegate, WKDownloadDelegate {
    private var window: NSWindow!
    private var webView: WKWebView!
    private var service: Process?
    private var serviceInput: Pipe?
    private var serviceOutput: Pipe?
    private var outputBuffer = Data()
    private var origin: URL?
    private var smokeReportPath: String?
    private var smokeProjectId: String?
    private var smokePageReport: [String: Any]?
    private var smokeDownloads: [String] = []
    private var smokeDownloadNames: [ObjectIdentifier: String] = [:]
    private var smokeStage = 0
    private var smokeStarted = false
    private var smokeFinishing = false
    private var closing = false

    func applicationDidFinishLaunching(_ notification: Notification) {
        do {
            let diagnostics = try parseArguments()
            smokeReportPath = diagnostics.reportPath
            smokeProjectId = diagnostics.projectId
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

    func webView(
        _ webView: WKWebView,
        runOpenPanelWith parameters: WKOpenPanelParameters,
        initiatedByFrame frame: WKFrameInfo,
        completionHandler: @escaping ([URL]?) -> Void
    ) {
        let panel = NSOpenPanel()
        panel.canChooseFiles = true
        panel.canChooseDirectories = parameters.allowsDirectories
        panel.allowsMultipleSelection = parameters.allowsMultipleSelection
        panel.beginSheetModal(for: window) { result in
            completionHandler(result == .OK ? panel.urls : nil)
        }
    }

    func webView(_ webView: WKWebView, navigationAction: WKNavigationAction, didBecome download: WKDownload) {
        download.delegate = self
    }

    func download(_ download: WKDownload, decideDestinationUsing response: URLResponse, suggestedFilename: String,
                  completionHandler: @escaping (URL?) -> Void) {
        if let reportPath = smokeReportPath {
            // Only the explicit diagnostic invocation may bypass user consent, inside its owned directory.
            let filename = URL(fileURLWithPath: suggestedFilename).lastPathComponent
            smokeDownloadNames[ObjectIdentifier(download)] = filename
            completionHandler(URL(fileURLWithPath: reportPath).deletingLastPathComponent().appendingPathComponent(filename))
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
        let name = smokeDownloadNames.removeValue(forKey: ObjectIdentifier(download)) ?? "unknown"
        smokeDownloads.append(name)
        if smokePageReport != nil && smokeDownloads.count == 2 { finishSmoke() }
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
        guard let projectId = smokeProjectId, smokeReportPath != nil, !smokeStarted else { return }
        smokeStarted = true
        if smokeStage == 0 {
            runSmokeEdit(projectId: projectId)
        } else {
            runSmokeReloadAndExports(projectId: projectId)
        }
    }

    private func runSmokeEdit(projectId: String) {
        webView.callAsyncJavaScript(
            Self.smokeEditScript,
            arguments: ["projectId": projectId, "persistedText": "NATIVE_LOGO_PERSISTED"],
            in: nil,
            in: .page
        ) { [weak self] result in
            guard let self else { return }
            switch result {
            case .success(let value):
                guard let report = value as? [String: Any] else { self.fail("Native edit report was invalid."); return }
                self.smokePageReport = report
                self.smokePageReport?["nativeWindowVisible"] = self.window.isVisible
                self.smokePageReport?["windowTitle"] = self.window.title
                self.smokePageReport?["backendUrl"] = self.origin?.absoluteString ?? ""
                self.smokePageReport?["backendPid"] = self.service?.processIdentifier ?? 0
                self.smokeStage = 1
                self.smokeStarted = false
                self.webView.reload()
            case .failure(let error): self.fail(String(describing: error))
            }
        }
    }

    private func runSmokeReloadAndExports(projectId: String) {
        guard let savedRevision = smokePageReport?["savedRevision"] as? Int else {
            fail("Native saved revision was unavailable before reload.")
            return
        }
        webView.callAsyncJavaScript(
            Self.smokeReloadAndExportScript,
            arguments: ["projectId": projectId, "persistedText": "NATIVE_LOGO_PERSISTED", "savedRevision": savedRevision],
            in: nil,
            in: .page
        ) { [weak self] result in
            guard let self else { return }
            switch result {
            case .success(let value):
                guard let report = value as? [String: Any] else { self.fail("Native export report was invalid."); return }
                for (key, value) in report { self.smokePageReport?[key] = value }
                if let error = report["error"] as? String { self.fail(error); return }
                if self.smokeDownloads.count == 2 { self.finishSmoke() }
            case .failure(let error): self.fail(String(describing: error))
            }
        }
    }

    private static let smokeEditScript = """
    const waitFor = (check, root = document.documentElement, timeoutMs = 60000) => {
      const immediate = check(); if (immediate) return Promise.resolve(immediate);
      return new Promise((resolve, reject) => {
        const observer = new MutationObserver(() => { const value = check(); if (!value) return; clearTimeout(timer); observer.disconnect(); resolve(value); });
        observer.observe(root, {subtree:true, childList:true, attributes:true, characterData:true});
        const timer = setTimeout(() => { observer.disconnect(); reject(new Error('Native UI event deadline exceeded')); }, timeoutMs);
      });
    };
    const json = async response => { const body = await response.json(); if (!response.ok || !body.data) throw new Error(`HTTP ${response.status}`); return body.data; };
    const frame = await waitFor(() => { const value = document.querySelector('iframe'); return value?.getAttribute('aria-busy') === 'false' ? value : null; });
    const projectBefore = await json(await fetch(`/api/projects/${projectId}`));
    const toolbar = await waitFor(() => [...document.querySelectorAll('button[aria-pressed]')].map(value => value.parentElement).find(value => value?.querySelectorAll(':scope > button').length >= 7));
    const edit = toolbar.querySelectorAll(':scope > button')[1]; if (!edit) throw new Error('Edit control unavailable'); edit.click();
    const overlay = await waitFor(() => [...frame.parentElement.children].find(value => value instanceof HTMLDivElement && value.style.pointerEvents === 'auto'));
    const rect = overlay.getBoundingClientRect(); overlay.dispatchEvent(new MouseEvent('click', {bubbles:true, clientX:rect.left + rect.width / 2, clientY:rect.top + rect.height / 2}));
    const textarea = await waitFor(() => document.getElementById('element-edit-text'));
    const descriptor = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value'); descriptor.set.call(textarea, persistedText); textarea.dispatchEvent(new Event('input', {bubbles:true}));
    let restoreFetch; const patched = new Promise((resolve, reject) => {
      const original = window.fetch; restoreFetch = () => { window.fetch = original; };
      const timer = setTimeout(() => { restoreFetch(); reject(new Error('Edit response deadline exceeded')); }, 60000);
      window.fetch = async (...args) => { const response = await original(...args); const request = args[0]; const url = typeof request === 'string' ? request : request.url; const method = args[1]?.method ?? (typeof request === 'string' ? 'GET' : request.method);
        if (method === 'PATCH' && new URL(url, location.href).pathname.includes(`/api/projects/${projectId}/fs/`)) { clearTimeout(timer); restoreFetch(); try { resolve(await json(response.clone())); } catch (error) { reject(error); } }
        return response;
      };
    });
    const save = textarea.closest('aside')?.querySelector('.sticky button'); if (!save) throw new Error('Save control unavailable'); save.click();
    const patch = await patched;
    if (patch.result_revision !== projectBefore.current_revision + 1) throw new Error('Edit revision did not advance exactly once');
    return {nativeWindowVisible:true, windowTitle:document.title, pageTitle:document.title, bodyTextLength:document.body?.innerText?.length ?? 0, canvasReady:true, projectId, baseRevision:projectBefore.current_revision, savedRevision:patch.result_revision};
    """

    private static let smokeReloadAndExportScript = """
    const diagnostics = {reloadPageTitle: document.title, reloadBodyTextLength: document.body?.innerText?.length ?? 0, reloadTextareaValue:null, reloadTextareaState:'not-mounted'};
    const waitFor = (check, root = document.documentElement, timeoutMs = 60000) => {
      const immediate = check(); if (immediate) return Promise.resolve(immediate);
      return new Promise((resolve, reject) => { const observer = new MutationObserver(() => { const value = check(); if (!value) return; clearTimeout(timer); observer.disconnect(); resolve(value); }); observer.observe(root, {subtree:true, childList:true, attributes:true,characterData:true}); const timer=setTimeout(()=>{observer.disconnect();reject(new Error('Native export event deadline exceeded'));},timeoutMs); });
    };
    const json = async response => { const body=await response.json(); if(!response.ok || !body.data) throw new Error(`HTTP ${response.status}`); return body.data; };
    const observePersistedTextarea = expected => new Promise((resolve, reject) => {
      const prototype = HTMLTextAreaElement.prototype;
      const descriptor = Object.getOwnPropertyDescriptor(prototype, 'value');
      let settled = false;
      const restore = () => Object.defineProperty(prototype, 'value', descriptor);
      const finish = (error, textarea) => { if (settled) return; settled = true; clearTimeout(timer); observer.disconnect(); restore(); error ? reject(error) : resolve(textarea); };
      const inspect = () => { const textarea=document.getElementById('element-edit-text'); if (!(textarea instanceof HTMLTextAreaElement)) return; diagnostics.reloadTextareaValue=textarea.value; diagnostics.reloadTextareaState=textarea.value===expected?'persisted':'hydrating'; if(textarea.value===expected)finish(null,textarea); };
      Object.defineProperty(prototype, 'value', {configurable:descriptor.configurable,enumerable:descriptor.enumerable,get:descriptor.get,set(value){descriptor.set.call(this,value);if(this.id==='element-edit-text'){diagnostics.reloadTextareaValue=String(value);diagnostics.reloadTextareaState=value===expected?'persisted':'hydrating';if(value===expected)finish(null,this);}}});
      const observer = new MutationObserver(inspect); observer.observe(document.documentElement,{subtree:true,childList:true});
      const timer=setTimeout(()=>{inspect();finish(new Error('Reloaded edit state did not reach the persisted value'));},60000);
      inspect();
    });
    try {
      const frame = await waitFor(() => { const value=document.querySelector('iframe'); return value?.getAttribute('aria-busy') === 'false' ? value : null; }).catch(error=>{throw new Error(`reload-frame: ${error}`)}); diagnostics.reloadBodyTextLength=document.body?.innerText?.length??0; diagnostics.reloadPageTitle=document.title;
      const project=await json(await fetch(`/api/projects/${projectId}`)); diagnostics.reloadedRevision=project.current_revision; diagnostics.expectedSavedRevision=savedRevision;
      if(project.current_revision!==savedRevision)throw new Error('Reloaded project revision did not match the saved revision');
      const toolbar = await waitFor(() => [...document.querySelectorAll('button[aria-pressed]')].map(value => value.parentElement).find(value => value?.querySelectorAll(':scope > button').length >= 7)); toolbar.querySelectorAll(':scope > button')[1].click();
      const textareaReady=observePersistedTextarea(persistedText);
      const overlay = await waitFor(() => [...frame.parentElement.children].find(value => value instanceof HTMLDivElement && value.style.pointerEvents === 'auto')).catch(error=>{throw new Error(`reload-overlay: ${error}`)});
      const rect=overlay.getBoundingClientRect(); overlay.dispatchEvent(new MouseEvent('click',{bubbles:true,clientX:rect.left+rect.width/2,clientY:rect.top+rect.height/2}));
      const textarea=await textareaReady; diagnostics.reloadTextareaValue=textarea.value; diagnostics.reloadTextareaState='persisted';
      const trigger = document.querySelector('button[aria-haspopup="menu"]:has(svg.lucide-download)'); if(!trigger) throw new Error('Export control unavailable'); trigger.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,button:0,pointerType:'mouse'})); trigger.click();
      const menu=await waitFor(()=>document.querySelector('[data-export-menu-content]')).catch(error=>{throw new Error(`export-menu: ${error}`)});
      const runExport = async (index, format) => {
        let createdId=null, restoreFetch; const terminal=new Promise((resolve,reject)=>{ const original=window.fetch; restoreFetch=()=>{window.fetch=original;}; const timer=setTimeout(()=>{restoreFetch();reject(new Error(`${format} export deadline exceeded`));},60000);
          window.fetch=async(...args)=>{ const response=await original(...args); const request=args[0]; const url=typeof request==='string'?request:request.url; const method=args[1]?.method??(typeof request==='string'?'GET':request.method); const pathname=new URL(url,location.href).pathname;
            try { if(method==='POST'&&pathname===`/api/projects/${projectId}/exports`){const data=await json(response.clone());if(data.format===format)createdId=data.id;} if(method==='GET'&&pathname===`/api/projects/${projectId}/exports`&&createdId){const jobs=await json(response.clone());const job=jobs.find(value=>value.id===createdId);if(job?.status==='failed')throw new Error(`${format} export failed`);if(job?.status==='succeeded'){clearTimeout(timer);restoreFetch();resolve(job);}} } catch(error){clearTimeout(timer);restoreFetch();reject(error);} return response; };
        });
        const item=menu.querySelectorAll('[role="menuitem"]')[index]; if(!item) throw new Error(`${format} menu item unavailable`); item.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,button:0,pointerType:'mouse'})); item.click(); const job=await terminal;
        await waitFor(()=>[...menu.querySelectorAll('li')].find(value=>[...value.querySelectorAll('span')].some(span=>span.textContent?.trim()===format.toUpperCase()))).catch(error=>{throw new Error(`${format}-download-row: ${error}`)});
        const response=await fetch(`/api/exports/${job.id}/download`); if(!response.ok)throw new Error(`${format} download HTTP ${response.status}`); const disposition=response.headers.get('content-disposition')??''; const filename=/filename="([^"]+)"/i.exec(disposition)?.[1]??`native-${format}`; const url=URL.createObjectURL(await response.blob()); const link=document.createElement('a');link.href=url;link.download=filename;link.click(); setTimeout(()=>URL.revokeObjectURL(url),1000); return {id:job.id,size:job.size_bytes,digest:job.latest_attempt?.digests?.output};
      };
      const svg=await runExport(0,'svg'); const pdf=await runExport(1,'pdf');
      return {...diagnostics,reloadPersisted:true,reloadedRevision:project.current_revision,exports:{svg,pdf}};
    } catch(error) {
      const textarea=document.getElementById('element-edit-text'); if(textarea instanceof HTMLTextAreaElement){diagnostics.reloadTextareaValue=textarea.value;diagnostics.reloadTextareaState=textarea.value===persistedText?'persisted':'mismatch';}
      return {...diagnostics,error:String(error?.message??error)};
    }
    """

    private func finishSmoke() {
        guard let reportPath = smokeReportPath, !smokeFinishing else { return }
        smokeFinishing = true
        var report = smokePageReport ?? ["error": "Native smoke did not complete"]
        report["downloadCompleted"] = smokeDownloads.count == 2
        report["downloads"] = smokeDownloads
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

    private func parseArguments() throws -> (reportPath: String?, projectId: String?) {
        let arguments = Array(CommandLine.arguments.dropFirst())
        if arguments.isEmpty { return (nil, nil) }
        guard arguments.count == 5, Array(arguments.prefix(2)) == smokeTestArguments, arguments[3] == "--smoke-project" else {
            throw NSError(domain: "BurnGuard", code: 1, userInfo: [NSLocalizedDescriptionKey: "Supported diagnostic arguments: --smoke-test --smoke-report <absolute JSON path> --smoke-project <project id>."])
        }
        guard arguments[2].hasPrefix("/"), !arguments[4].isEmpty else {
            throw NSError(domain: "BurnGuard", code: 1, userInfo: [NSLocalizedDescriptionKey: "The native smoke report path must be absolute and a project id is required."])
        }
        return (arguments[2], arguments[4])
    }

    private func createWindow() throws {
        NSApp.setActivationPolicy(.regular)
        let configuration = WKWebViewConfiguration()
        if smokeReportPath != nil { configuration.websiteDataStore = .nonPersistent() }
        webView = WKWebView(frame: .zero, configuration: configuration)
        webView.navigationDelegate = self
        webView.uiDelegate = self

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
        // Finder and Dock launches inherit launchd's minimal PATH; put the usual user tool directories first so CLIs resolve.
        let searchPath = (environment["PATH"] ?? "/usr/bin:/bin:/usr/sbin:/sbin").split(separator: ":").map(String.init)
        let userPaths = [NSHomeDirectory() + "/.local/bin", "/opt/homebrew/bin", "/usr/local/bin", NSHomeDirectory() + "/.bun/bin"].filter { !searchPath.contains($0) }
        environment["PATH"] = (userPaths + searchPath).joined(separator: ":")
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
            // At EOF the handler keeps firing with empty data until it is cleared.
            if data.isEmpty { handle.readabilityHandler = nil; return }
            DispatchQueue.main.async { self?.consumeServiceOutput(data) }
        }
        errorOutput.fileHandleForReading.readabilityHandler = { handle in
            if handle.availableData.isEmpty { handle.readabilityHandler = nil }
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
            let target = smokeProjectId.map { url.appendingPathComponent("projects").appendingPathComponent($0) } ?? url
            webView.load(URLRequest(url: target))
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
            guard !smokeFinishing else { return }
            smokeFinishing = true
            var report = smokePageReport ?? [:]
            report["nativeWindowVisible"] = window?.isVisible ?? false
            report["windowTitle"] = window?.title ?? ""
            report["pageTitle"] = report["pageTitle"] ?? ""
            report["bodyTextLength"] = report["bodyTextLength"] ?? 0
            report["backendUrl"] = origin?.absoluteString ?? ""
            report["backendPid"] = service?.processIdentifier ?? 0
            report["error"] = message
            guard webView != nil else {
                writeReport(report, to: reportPath)
                shutdown()
                return
            }
            webView.takeSnapshot(with: nil) { [weak self] image, error in
                guard let self else { return }
                if error == nil, let tiff = image?.tiffRepresentation,
                   let png = NSBitmapImageRep(data: tiff)?.representation(using: .png, properties: [:]) {
                    try? png.write(to: URL(fileURLWithPath: reportPath + ".png"), options: .atomic)
                    report["failureSnapshotCaptured"] = true
                } else {
                    report["failureSnapshotCaptured"] = false
                }
                self.writeReport(report, to: reportPath)
                self.shutdown()
            }
        } else {
            let alert = NSAlert()
            alert.messageText = "BurnGuard"
            alert.informativeText = message
            alert.alertStyle = .warning
            alert.runModal()
            shutdown()
        }
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
