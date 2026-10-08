import AppKit
import Foundation
import WebKit

private let smokeTestArguments = ["--smoke-test", "--smoke-report"]

// Shell dialog strings live in i18n/<language>.json (bundled by scripts/build-mac.ts); the language
// follows the SPA's first-run rule: Korean -> ko, Simplified Chinese -> zh, anything else -> en.
private let shellLanguage: String = {
    let parts = (Locale.preferredLanguages.first ?? "").lowercased().split(whereSeparator: { $0 == "-" || $0 == "_" }).map(String.init)
    if parts.first == "ko" { return "ko" }
    guard parts.first == "zh" else { return "en" }
    if parts.contains("hans") { return "zh" }
    return parts.contains(where: { ["hant", "tw", "hk", "mo"].contains($0) }) ? "en" : "zh"
}()

private func shellTable(_ language: String) -> [String: String] {
    guard let url = Bundle.main.url(forResource: language, withExtension: "json", subdirectory: "i18n"),
          let data = try? Data(contentsOf: url),
          let table = try? JSONSerialization.jsonObject(with: data) as? [String: String] else { return [:] }
    return table
}

private let shellStrings = shellTable(shellLanguage)
private let fallbackShellStrings = shellTable("en")

private func shellText(_ key: String, _ values: String...) -> String {
    var text = shellStrings[key] ?? fallbackShellStrings[key] ?? key
    for (index, value) in values.enumerated() { text = text.replacingOccurrences(of: "{\(index)}", with: value) }
    return text
}

final class BurnGuardAppDelegate: NSObject, NSApplicationDelegate, NSWindowDelegate, WKNavigationDelegate, WKUIDelegate, WKDownloadDelegate {
    private var window: NSWindow!
    private var webView: WKWebView!
    private var service: Process?
    private var serviceInput: Pipe?
    private var serviceOutput: Pipe?
    private var outputBuffer = Data()
    private var startupFailure: String?
    private var origin: URL?
    private var expectedOrigin: String?
    private var smokeReportPath: String?
    private var smokeProjectId: String?
    private var smokePageReport: [String: Any]?
    private var smokeDownloads: [String] = []
    private var smokeDownloadNames: [ObjectIdentifier: String] = [:]
    private var pendingReplacements: [ObjectIdentifier: (temporary: URL, target: URL)] = [:]
    private var smokeStage = 0
    private var smokeStarted = false
    private var smokeFinishing = false
    private var closing = false
    private var closeConfirmed = false
    private var closeDecisionWaiters: [(Bool) -> Void] = []
    private var closeQuery = 0
    private var terminationReplyPending = false

    func applicationDidFinishLaunching(_ notification: Notification) {
        installMainMenu()
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
        // The shell exits only after its backend; finishTermination answers once the service has exited.
        guard service?.isRunning == true else { return .terminateNow }
        if terminationReplyPending { return .terminateCancel }
        terminationReplyPending = true
        confirmCloseIfGenerating { [weak self] proceed in
            guard let self else { return }
            if proceed { self.shutdown(); return }
            self.terminationReplyPending = false
            NSApp.reply(toApplicationShouldTerminate: false)
        }
        return .terminateLater
    }

    // windowWillClose cannot cancel; the close is held here until the backend reports no running generation or the user confirms.
    func windowShouldClose(_ sender: NSWindow) -> Bool {
        if closeConfirmed || closing { return true }
        confirmCloseIfGenerating { [weak self] proceed in
            guard let self, proceed else { return }
            self.closeConfirmed = true
            self.window.close()
        }
        return false
    }

    func windowWillClose(_ notification: Notification) {
        shutdown()
    }

    // Asks the backend over the private stdin pipe; no answer in two seconds counts as idle, so a hung backend never blocks closing.
    private func confirmCloseIfGenerating(_ decided: @escaping (Bool) -> Void) {
        guard smokeReportPath == nil, !closing, origin != nil, service?.isRunning == true else { decided(true); return }
        closeDecisionWaiters.append(decided)
        guard closeDecisionWaiters.count == 1 else { return }
        closeQuery += 1
        let query = closeQuery
        serviceInput?.fileHandleForWriting.write(Data("active-turns\n".utf8))
        DispatchQueue.main.asyncAfter(deadline: .now() + 2) { [weak self] in
            guard let self, self.closeQuery == query else { return }
            self.decideClose(activeTurns: 0)
        }
    }

    private func decideClose(activeTurns: Int) {
        guard !closeDecisionWaiters.isEmpty else { return }
        let waiters = closeDecisionWaiters
        closeDecisionWaiters = []
        closeQuery += 1
        let proceed = activeTurns == 0 || confirmCloseDuringTurn()
        waiters.forEach { $0(proceed) }
    }

    // Keep working is the default button, so Return keeps the generation running.
    private func confirmCloseDuringTurn() -> Bool {
        let alert = NSAlert()
        alert.messageText = "BurnGuard"
        alert.informativeText = shellText("closeRunning.message")
        alert.alertStyle = .warning
        alert.addButton(withTitle: shellText("closeRunning.keep"))
        alert.addButton(withTitle: shellText("closeRunning.close"))
        return alert.runModal() == .alertSecondButtonReturn
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
        // Like the Windows shell, raw API and runtime responses never replace the SPA at the top level.
        if navigationAction.targetFrame?.isMainFrame == true, isAppURL(url), !isTopLevelAppRoute(url) {
            decisionHandler(.cancel)
            return
        }
        // Parent-owned link clicks that leave the app open in the default browser, mirroring the Windows shell.
        if navigationAction.navigationType == .linkActivated, navigationAction.sourceFrame.isMainFrame,
           navigationAction.targetFrame?.isMainFrame != false {
            openExternal(url)
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

    func webView(
        _ webView: WKWebView,
        createWebViewWith configuration: WKWebViewConfiguration,
        for navigationAction: WKNavigationAction,
        windowFeatures: WKWindowFeatures
    ) -> WKWebView? {
        // window.open never gets a second web view; external targets go to the default browser instead.
        if let url = navigationAction.request.url { openExternal(url) }
        return nil
    }

    // The Windows shell denies every WebView2 permission request; camera and microphone are denied here too.
    func webView(
        _ webView: WKWebView,
        requestMediaCapturePermissionFor securityOrigin: WKSecurityOrigin,
        initiatedByFrame frame: WKFrameInfo,
        type: WKMediaCaptureType,
        decisionHandler: @escaping (WKPermissionDecision) -> Void
    ) {
        decisionHandler(.deny)
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
            guard result == .OK, let url = panel.url else { completionHandler(nil); return }
            // WKDownload refuses an existing destination, so a confirmed replacement downloads beside it and swaps only on success.
            guard FileManager.default.fileExists(atPath: url.path) else { completionHandler(url); return }
            let temporary = url.deletingLastPathComponent().appendingPathComponent(".\(url.lastPathComponent).burnguard-download-\(UUID().uuidString)")
            self.pendingReplacements[ObjectIdentifier(download)] = (temporary: temporary, target: url)
            completionHandler(temporary)
        }
    }

    func download(_ download: WKDownload, willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest,
                  decisionHandler: @escaping (WKDownload.RedirectPolicy) -> Void) {
        decisionHandler(request.url.map(isAppURL) == true ? .allow : .cancel)
    }

    func downloadDidFinish(_ download: WKDownload) {
        if let replacement = pendingReplacements.removeValue(forKey: ObjectIdentifier(download)) {
            do { _ = try FileManager.default.replaceItemAt(replacement.target, withItemAt: replacement.temporary) }
            catch { try? FileManager.default.removeItem(at: replacement.temporary); alertDownloadFailed() }
        }
        guard smokeReportPath != nil else { return }
        let name = smokeDownloadNames.removeValue(forKey: ObjectIdentifier(download)) ?? "unknown"
        smokeDownloads.append(name)
        if smokePageReport != nil && smokeDownloads.count == 2 { finishSmoke() }
    }

    func download(_ download: WKDownload, didFailWithError error: Error, resumeData: Data?) {
        // The confirmed original stays untouched; only the partial download beside it is discarded.
        if let replacement = pendingReplacements.removeValue(forKey: ObjectIdentifier(download)) { try? FileManager.default.removeItem(at: replacement.temporary) }
        if (error as NSError).domain == NSURLErrorDomain && (error as NSError).code == NSURLErrorCancelled { return }
        if smokeReportPath != nil {
            fail("Native download failed.")
        } else {
            alertDownloadFailed()
        }
    }

    private func alertDownloadFailed() {
        let alert = NSAlert()
        alert.messageText = "BurnGuard"
        alert.informativeText = shellText("downloadFailed")
        alert.beginSheetModal(for: window)
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
    const edit = await waitFor(() => document.querySelector('button[aria-pressed]:has(svg.lucide-pencil)'));
    edit.click();
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
      const edit = await waitFor(() => document.querySelector('button[aria-pressed]:has(svg.lucide-pencil)')); edit.click();
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
        fail(shellText("viewLoadFailedDetail", error.localizedDescription))
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

    // AppKit delivers Cmd-key editing, quit and close only through main-menu key equivalents; nil targets reach the web view.
    private func installMainMenu() {
        let appMenu = NSMenu(title: "BurnGuard")
        appMenu.addItem(withTitle: shellText("menu.quit"), action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        let editMenu = NSMenu(title: shellText("menu.edit"))
        editMenu.addItem(withTitle: shellText("menu.undo"), action: Selector(("undo:")), keyEquivalent: "z")
        editMenu.addItem(withTitle: shellText("menu.redo"), action: Selector(("redo:")), keyEquivalent: "Z")
        editMenu.addItem(withTitle: shellText("menu.cut"), action: #selector(NSText.cut(_:)), keyEquivalent: "x")
        editMenu.addItem(withTitle: shellText("menu.copy"), action: #selector(NSText.copy(_:)), keyEquivalent: "c")
        editMenu.addItem(withTitle: shellText("menu.paste"), action: #selector(NSText.paste(_:)), keyEquivalent: "v")
        editMenu.addItem(withTitle: shellText("menu.selectAll"), action: #selector(NSText.selectAll(_:)), keyEquivalent: "a")
        let windowMenu = NSMenu(title: shellText("menu.window"))
        windowMenu.addItem(withTitle: shellText("menu.minimize"), action: #selector(NSWindow.performMiniaturize(_:)), keyEquivalent: "m")
        windowMenu.addItem(withTitle: shellText("menu.close"), action: #selector(NSWindow.performClose(_:)), keyEquivalent: "w")
        let mainMenu = NSMenu()
        for menu in [appMenu, editMenu, windowMenu] { mainMenu.addItem(withTitle: menu.title, action: nil, keyEquivalent: "").submenu = menu }
        NSApp.mainMenu = mainMenu
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

    /// PATH entries of the user's login shell; any failure or timeout yields no entries and the value is never logged.
    /// Runs on a background queue; the 3 s deadline covers both the shell exit and the end of its output.
    private func loginShellPathEntries() -> [String] {
        var shell = "/bin/zsh"
        if let value = ProcessInfo.processInfo.environment["SHELL"], !value.isEmpty {
            shell = value
        } else if let entry = getpwuid(getuid()), let value = entry.pointee.pw_shell {
            shell = String(cString: value)
        }
        if !FileManager.default.isExecutableFile(atPath: shell) { shell = "/bin/zsh" }

        let probe = Process()
        let pipe = Pipe()
        let exited = DispatchSemaphore(value: 0)
        let drained = DispatchSemaphore(value: 0)
        let lock = NSLock()
        var collected = Data()
        probe.executableURL = URL(fileURLWithPath: shell)
        // zsh keeps nvm/fnm setup in ~/.zshrc, which only interactive shells read.
        let flags = URL(fileURLWithPath: shell).lastPathComponent == "zsh" ? ["-i", "-l", "-c"] : ["-l", "-c"]
        probe.arguments = flags + ["printf '__BG_PATH__%s__BG_PATH__' \"$PATH\""]
        probe.standardInput = FileHandle.nullDevice
        probe.standardOutput = pipe
        probe.standardError = FileHandle.nullDevice
        probe.terminationHandler = { _ in exited.signal() }
        pipe.fileHandleForReading.readabilityHandler = { handle in
            let data = handle.availableData
            // At EOF the handler keeps firing with empty data until it is cleared.
            if data.isEmpty { handle.readabilityHandler = nil; drained.signal(); return }
            lock.lock(); collected.append(data); lock.unlock()
        }
        do { try probe.run() } catch {
            pipe.fileHandleForReading.readabilityHandler = nil
            return []
        }
        try? pipe.fileHandleForWriting.close()
        let deadline = DispatchTime.now() + 3
        guard exited.wait(timeout: deadline) == .success, drained.wait(timeout: deadline) == .success else {
            pipe.fileHandleForReading.readabilityHandler = nil
            if probe.isRunning {
                probe.terminate()
                // An interactive zsh can ignore SIGTERM, so follow with SIGKILL.
                kill(probe.processIdentifier, SIGKILL)
            }
            return []
        }
        lock.lock(); let data = collected; lock.unlock()
        // Startup files may print noise around the value; only the text between the markers counts and only absolute entries are kept.
        guard let text = String(data: data, encoding: .utf8),
              let end = text.range(of: "__BG_PATH__", options: .backwards),
              let start = text[..<end.lowerBound].range(of: "__BG_PATH__", options: .backwards) else { return [] }
        return text[start.upperBound..<end.lowerBound].split(separator: ":").map(String.init).filter { $0.hasPrefix("/") }
    }

    /// Installed nvm version directory for the `default` alias, else the newest installed version.
    private func nvmVersionDirectory(home: String, versions: [String]) -> String? {
        let numeric: (String, String) -> Bool = { $0.compare($1, options: .numeric) == .orderedAscending }
        let newest = versions.sorted(by: numeric).last
        var alias = (try? String(contentsOfFile: home + "/.nvm/alias/default", encoding: .utf8))?.trimmingCharacters(in: .whitespacesAndNewlines)
        // Aliases may point at other aliases (default -> lts/* -> lts/iron -> v20.x).
        for _ in 0..<4 {
            guard let value = alias, !value.isEmpty else { break }
            let bare = value.hasPrefix("v") ? String(value.dropFirst()) : value
            if let first = bare.first, first.isNumber {
                let matches = versions.filter { $0 == "v" + bare || $0.hasPrefix("v" + bare + ".") }
                if let match = matches.sorted(by: numeric).last { return match }
                break
            }
            alias = (try? String(contentsOfFile: home + "/.nvm/alias/" + value, encoding: .utf8))?.trimmingCharacters(in: .whitespacesAndNewlines)
        }
        return newest
    }

    /// Well-known Node manager directories that exist on disk; the nvm default alias wins over the newest nvm version.
    private func managerPathEntries() -> [String] {
        let home = NSHomeDirectory()
        let fileManager = FileManager.default
        var candidates = [
            home + "/.volta/bin",
            home + "/.npm-global/bin",
            home + "/.local/share/fnm/aliases/default/bin",
            home + "/Library/Application Support/fnm/aliases/default/bin"
        ]
        let nvmRoot = home + "/.nvm/versions/node"
        if let versions = try? fileManager.contentsOfDirectory(atPath: nvmRoot),
           let version = nvmVersionDirectory(home: home, versions: versions) {
            candidates.append(nvmRoot + "/" + version + "/bin")
        }
        return candidates.filter { fileManager.fileExists(atPath: $0) }
    }

    private func startService() throws {
        let serviceURL = Bundle.main.bundleURL
            .appendingPathComponent("Contents/MacOS/burnguard-design")
        guard FileManager.default.isExecutableFile(atPath: serviceURL.path) else {
            throw NSError(domain: "BurnGuard", code: 1, userInfo: [NSLocalizedDescriptionKey: "Contents/MacOS/burnguard-design is missing or not executable."])
        }
        // The login-shell probe may take a few seconds; keep the main thread free and launch the backend once it answers.
        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            let loginEntries = self?.loginShellPathEntries() ?? []
            DispatchQueue.main.async {
                guard let self, !self.closing else { return }
                do { try self.launchService(serviceURL: serviceURL, loginEntries: loginEntries) } catch { self.fail(error.localizedDescription) }
            }
        }
    }

    private func launchService(serviceURL: URL, loginEntries: [String]) throws {
        let input = Pipe()
        let output = Pipe()
        let errorOutput = Pipe()
        let process = Process()
        var environment = ProcessInfo.processInfo.environment
        // Finder and Dock launches inherit launchd's minimal PATH: lead with the login shell's PATH (nvm, Volta, fnm, custom npm prefixes), keep the usual user tool directories as fallback, then add known manager directories.
        let searchPath = (environment["PATH"] ?? "/usr/bin:/bin:/usr/sbin:/sbin").split(separator: ":").map(String.init)
        let fixedPaths = [NSHomeDirectory() + "/.local/bin", "/opt/homebrew/bin", "/usr/local/bin", NSHomeDirectory() + "/.bun/bin"]
        var merged: [String] = []
        for entry in loginEntries + fixedPaths + searchPath + managerPathEntries() where !merged.contains(entry) {
            merged.append(entry)
        }
        environment["PATH"] = merged.joined(separator: ":")
        environment["BG_DESKTOP"] = "1"
        environment["BG_NO_OPEN"] = "1"
        environment["BG_DEV"] = "0"
        environment["BG_UPDATE_WAIT_PID"] = String(ProcessInfo.processInfo.processIdentifier)
        // The readiness line must name exactly this port, so the backend may not scan for another one.
        let port = environment["BG_PORT"] ?? "14070"
        guard let portNumber = UInt16(port), portNumber >= 1024 else { throw startupError("invalid_port", port: port) }
        guard portIsFree(portNumber) else { throw startupError("port_busy", port: port) }
        environment["BG_PORT"] = port
        environment.removeValue(forKey: "BG_SCAN_PORT")
        expectedOrigin = "http://127.0.0.1:\(port)"
        process.executableURL = serviceURL
        process.standardInput = input
        process.standardOutput = output
        process.standardError = errorOutput
        process.environment = environment
        service = process
        serviceInput = input
        serviceOutput = output

        // Hold through enqueue so a chunk already read by a callback precedes the final EOF drain.
        let outputLock = NSLock()
        output.fileHandleForReading.readabilityHandler = { [weak self] handle in
            outputLock.lock()
            defer { outputLock.unlock() }
            let data = handle.availableData
            // At EOF the handler keeps firing with empty data until it is cleared.
            if data.isEmpty { handle.readabilityHandler = nil; return }
            DispatchQueue.main.async { self?.consumeServiceOutput(data) }
        }
        errorOutput.fileHandleForReading.readabilityHandler = { handle in
            if handle.availableData.isEmpty { handle.readabilityHandler = nil }
        }
        process.terminationHandler = { [weak self] process in
            outputLock.lock()
            defer { outputLock.unlock() }
            // The backend may print startup_failed just before exiting; read what is left before choosing the message.
            output.fileHandleForReading.readabilityHandler = nil
            let remaining = try? output.fileHandleForReading.readToEnd()
            DispatchQueue.main.async {
                guard let self else { return }
                if self.closing { self.finishTermination(); return }
                if let remaining, !remaining.isEmpty { self.consumeServiceOutput(remaining); if self.closing { return } }
                if let message = self.startupFailure { self.fail(message); return }
                self.fail(shellText("serverExitedCode", String(process.terminationStatus)))
            }
        }
        try process.run()
        // Cold profiles seed and validate every bundled sample before readiness.
        DispatchQueue.main.asyncAfter(deadline: .now() + 300) { [weak self] in
            guard let self, !self.closing, self.origin == nil else { return }
            self.fail(shellText("startTimeout"))
        }
    }

    // Known backend startup_failed codes map to the shell table; unknown codes keep the generic exit message.
    private func startupMessage(_ code: String?, port: String) -> String? {
        guard let code, ["port_busy", "profile_owned", "invalid_port"].contains(code) else { return nil }
        return shellText("startup_failed.\(code)").replacingOccurrences(of: "{0}", with: port)
    }

    private func startupError(_ code: String, port: String) -> NSError {
        NSError(domain: "BurnGuard", code: 2, userInfo: [NSLocalizedDescriptionKey: startupMessage(code, port: port) ?? code])
    }

    /// Mirrors the Windows shell's TcpListener probe: a bind on the loopback port fails while another process is listening.
    private func portIsFree(_ port: UInt16) -> Bool {
        let descriptor = socket(AF_INET, SOCK_STREAM, 0)
        guard descriptor >= 0 else { return true }
        defer { Darwin.close(descriptor) }
        var reuse: Int32 = 1
        setsockopt(descriptor, SOL_SOCKET, SO_REUSEADDR, &reuse, socklen_t(MemoryLayout<Int32>.size))
        var address = sockaddr_in()
        address.sin_len = UInt8(MemoryLayout<sockaddr_in>.size)
        address.sin_family = sa_family_t(AF_INET)
        address.sin_port = port.bigEndian
        address.sin_addr.s_addr = inet_addr("127.0.0.1")
        let result = withUnsafePointer(to: &address) {
            $0.withMemoryRebound(to: sockaddr.self, capacity: 1) { Darwin.bind(descriptor, $0, socklen_t(MemoryLayout<sockaddr_in>.size)) }
        }
        return result == 0
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
                fail(shellText("startupResponseInvalid"))
                return
            }
            if message["event"] as? String == "startup_failed" {
                startupFailure = startupMessage(message["code"] as? String, port: expectedOrigin.flatMap { URL(string: $0)?.port.map(String.init) } ?? "14070")
                return
            }
            if message["event"] as? String == "active-turns" {
                let count = message["count"] as? Int ?? 0
                // The confirmation is modal; run it outside this read loop.
                DispatchQueue.main.async { [weak self] in self?.decideClose(activeTurns: count) }
                continue
            }
            if message["event"] as? String == "shutdown" {
                closing = true
                awaitServiceExit()
                return
            }
            guard let urlString = message["url"] as? String,
                  let pid = message["pid"] as? Int32,
                  let service, pid == service.processIdentifier,
                  urlString == expectedOrigin,
                  let bootstrap = message["bootstrap"] as? String,
                  isBootstrapSecret(bootstrap),
                  let url = URL(string: urlString),
                  // The one-time secret lets only this web view mint the launch capability; the SPA strips the fragment.
                  let launch = URL(string: (smokeProjectId.map { url.appendingPathComponent("projects").appendingPathComponent($0) } ?? url).absoluteString + "#bg-bootstrap:" + bootstrap) else {
                fail(shellText("startupResponseInvalid"))
                return
            }
            origin = url
            webView.load(URLRequest(url: launch))
        }
    }

    private func isBootstrapSecret(_ value: String) -> Bool {
        value.utf8.count >= 16 && value.utf8.allSatisfy { byte in
            (byte >= 48 && byte <= 57) || (byte >= 65 && byte <= 90) || (byte >= 97 && byte <= 122) || byte == 45 || byte == 95
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

    private func isTopLevelAppRoute(_ url: URL) -> Bool {
        let path = (URLComponents(url: url, resolvingAgainstBaseURL: false)?.percentEncodedPath ?? url.path).lowercased()
        return !path.hasPrefix("/api/") && !path.hasPrefix("/runtime/")
    }

    private func openExternal(_ url: URL) {
        guard url.scheme == "https" || url.scheme == "http", url.user == nil, url.password == nil, !isAppURL(url) else { return }
        NSWorkspace.shared.open(url)
    }

    private func isAppDownloadURL(_ url: URL) -> Bool {
        if isAppURL(url) { return true }
        guard url.scheme == "blob", let blobURL = URL(string: String(url.absoluteString.dropFirst(5))) else { return false }
        return isAppURL(blobURL)
    }

    private func writeReport(_ report: [String: Any], to path: String) {
        guard let data = try? JSONSerialization.data(withJSONObject: report, options: [.prettyPrinted]) else {
            fail(shellText("smokeSerializeFailed"))
            return
        }
        do {
            try data.write(to: URL(fileURLWithPath: path), options: .atomic)
        } catch {
            fail(shellText("smokeWriteFailed", error.localizedDescription))
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
        awaitServiceExit()
    }

    // The termination handler finishes the exit; the backend handles SIGTERM as its own drain, so a stuck drain gets SIGKILL.
    private func awaitServiceExit() {
        guard let service, service.isRunning else { DispatchQueue.main.async { [weak self] in self?.finishTermination() }; return }
        DispatchQueue.main.asyncAfter(deadline: .now() + 15) {
            if service.isRunning { kill(service.processIdentifier, SIGKILL) }
        }
    }

    private func finishTermination() {
        if terminationReplyPending { NSApp.reply(toApplicationShouldTerminate: true) } else { NSApp.terminate(nil) }
    }
}

let application = NSApplication.shared
let delegate = BurnGuardAppDelegate()
application.delegate = delegate
application.run()
