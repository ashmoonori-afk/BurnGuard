# BurnGuard user guide

Use this guide for a first website, an image correction or a move to another computer. Corrections you make often can be kept with **Keep as rule** in the conversation, and **Project instructions** in the project top bar holds notes that every request should follow. For installation and supported platforms, see the [README](../README.md#get-started). The steps below use English interface labels; Settings lets you change the language.

## First website in 10 minutes

Start with the app installed and a generation CLI authenticated. Generation time depends on the selected provider and the size of your request.

1. Open Settings, connect your installed CLI and choose a model. If the connection is unavailable, check its sign-in state before creating a project. You can explore a bundled example without connecting a provider.
2. On Home, create a **Web design** project and describe your idea in one or two sentences. A project name is suggested from the idea, and the audience is optional; open the advanced options only when you need them. On the very first launch a short guide on Home does the same in one card.
3. Pick a design system, or continue without one. For a first attempt, choose a bundled theme rather than importing a new system.
4. Keep the first brief small: "Make a one-page website for a local pottery workshop. Visitors should find the next class date and request a place. Include an introduction, class details and a contact section. Do not invent prices or reviews."
5. Press the start action once: it creates the project and sends your idea as the first request, so generation starts right away. If that first send fails, the project is kept and the request waits in the message composer to send again.
6. Wait for generation to finish and inspect the canvas. For a website, the canvas toolbar offers **Fit**, **Desktop 1440**, **Tablet 768** and **Phone 390** widths (under **More** when the toolbar is narrow). Then and ask for one concrete correction at a time. Use the Quality and UX panels to review findings; they do not replace looking at the page.
7. Use the export controls to download an HTML ZIP. Open the exported page and check its text, images and links before sharing it.

If generation stops, check **Settings > Runtime diagnostics** and the conversation's recovery action. Keep the existing project while investigating. A recovered unverified draft is separate from the original and is not verified until its full design audit passes.

## Fix a bad image

1. Open the project and identify the image and the page where it appears. Attach a suitable reference if the subject, proportions or scale matter.
2. Open **Options** under the message box and set **Edit scope** to **Images only**. Describe a specific replacement, for example: "Replace the workshop hero photo with a realistic wide photograph of hands shaping a clay bowl. Keep the text and layout unchanged."
3. To limit the change further, expand **Target pages and nodes** and enter the project-relative HTML page and any artboard or node identifiers. [Scope syntax and limits](edit-scope.md#request-contract).
4. Send the request. If it changes text, layout or other content outside the selected scope, BurnGuard refuses publication and keeps the previous committed result. Correct the request, or explicitly choose unrestricted scope when the layout really must change.
5. Inspect the new image in the canvas and review the history comparison. History shows a small before and after thumbnail for each revision next to the list of changed sources. Use history to restore a saved version if needed.

Changing a CSS background's URL changes styles and requires unrestricted scope. Replacing image bytes used in several places must be permitted at every use; targeting one placement does not authorize changing the others.

## Move a project to another Mac

1. Finish generation and saving on the original Mac. Open the project and choose **Download project backup** (under **More** on narrower windows) to download a `.burnguard-project` file.
2. Copy that bundle to the other Mac and install BurnGuard there. Use the same or a newer compatible app version.
3. On Home, open **Import project** and enter a name for the restored project. Select **BurnGuard project backup**, choose the bundle with **Select project backup**, then choose **Import and open**.
4. The restore creates a new project; it does not overwrite an existing one. Review any missing-font or missing-theme warnings, then inspect the canvas before continuing.
5. Connect and authenticate your generation CLI on the destination Mac. Saved credentials, API keys, local configuration and launch authority are not transferred.

The bundle carries editable project files, retained materials, checkpoints and design-system links. It is not a full profile or conversation-history backup. Import limits are 48 MB compressed, 128 MB unpacked and 10,000 files. Review your own files and attachments for confidential content before sharing a bundle.

## Where files live

The default profile is `~/.burnguard` on macOS and Linux, or `%USERPROFILE%\.burnguard` on Windows. A custom `BG_APP_ROOT` changes this location.

| Location inside the profile | Contents |
|---|---|
| `burnguard.db` | Project, session and event records |
| `data/projects/` | Managed project files and retained project materials |
| `data/systems/` | Installed reusable design systems |
| `cache/exports/` | Generated export cache |
| `config.json`, `config.local.<platform>.json` | Local settings; treat these as private |
| `logs/` | Local diagnostics; review before sharing |

Downloaded exports and project bundles go to the download location chosen by your browser or desktop shell. Keep the profile when updating BurnGuard. Use a project bundle to move an individual project rather than copying one managed project directory without its database records. For a full profile backup, close BurnGuard first and preserve the entire profile privately.
