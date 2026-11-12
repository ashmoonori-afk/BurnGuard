# BurnGuard user guide

Use this guide to build your first website, make a set of linked app screens, edit a single image, line up elements by hand, or move a project to another computer. In chat, select **Keep as rule** to save a recurring correction, and use **Project instructions** in the project top bar to store standing notes sent with every request. For installation and supported platforms, see the [README](../README.md#get-started). The steps below use English interface labels; you can change the language in Settings.

## First website in 10 minutes

Start with the app installed and a generation CLI authenticated. Generation time depends on the selected provider and the size of your request.

1. Open Settings, connect your installed CLI and choose a model. If the connection is unavailable, check its sign-in state before creating a project. You can explore a bundled example without connecting a provider.
2. On Home, create a **Web design** project and describe your idea in one or two sentences. A project name is suggested from the idea, and the audience is optional; open the advanced options only when you need them. On the very first launch a short guide on Home does the same in one card.
3. Pick a design system, or continue without one. For a first attempt, choose a bundled theme rather than importing a new system.
4. Keep the first brief small: "Make a one-page website for a local pottery workshop. Visitors should find the next class date and request a place. Include an introduction, class details and a contact section. Do not invent prices or reviews."
5. Press the start action once: it creates the project and sends your idea as the first request, so generation starts right away. If that first send fails, the project is kept and the request waits in the message composer to send again.
6. Wait for generation to finish, then inspect the canvas. Website projects include **Fit**, **Desktop 1440**, **Tablet 768**, and **Phone 390** width presets in the canvas toolbar (or inside **More** on narrow windows). Ask for one specific correction at a time, and use the Quality and UX panels to check findings alongside your own visual review.
7. Use the export controls to download an HTML ZIP. Open the exported page and check its text, images and links before sharing it.

If generation stops, check **Settings > Runtime diagnostics** and the conversation's recovery action. Keep the existing project while investigating. A recovered unverified draft is separate from the original and is not verified until its full design audit passes.

## Make a set of app screens

1. On Home, choose the **App screens** format and describe the app in one line, for example: "A habit tracker with a home tab, a habit detail screen and a weekly summary."
2. Under **Frame**, keep **Phone 390 x 844** or choose **Desktop 1440 x 900**. BurnGuard's own window stays a desktop app; only the generated screens use this size.
3. After generation, the **Board** shows the screens grouped in sections. Each screen card lists the screens it links to.
4. Select **Play section** to tap through a section from its first screen, or **Play from here** on one screen. Use **Previous** and **Next**, or select a link inside the screen; Esc closes the overlay.
5. Select a screen to open it in the canvas editor, then ask in chat for changes to that screen.

Each screen is one HTML file under `screens/`, and `screens.json` records the sections and their order. If that file is missing or invalid, every screen is shown in one **Screens** section.

## Fix a bad image

1. Open the project and identify the image and the page where it appears. Attach a suitable reference if the subject, proportions or scale matter.
2. Select **Options** below the message input and set **Edit scope** to **Images only**. Write a specific replacement request, such as: "Replace the workshop hero photo with a realistic wide photograph of hands shaping a clay bowl. Keep the text and layout unchanged."
3. To limit the change further, expand **Target pages and nodes** and enter the project-relative HTML page and any artboard or node identifiers. [Scope syntax and limits](edit-scope.md#request-contract).
4. Send the request. If it changes text, layout or other content outside the selected scope, BurnGuard refuses publication and keeps the previous committed result. Correct the request, or explicitly choose unrestricted scope when the layout really must change.
5. Inspect the new image in the canvas and review the history comparison. History shows a small before and after thumbnail for each revision next to the list of changed sources. Use history to restore a saved version if needed.

Changing a CSS background's URL changes styles and requires unrestricted scope. Replacing image bytes used in several places must be permitted at every use; targeting one placement does not authorize changing the others.

## Line up elements by hand

Use this when the generated layout is nearly right and one element needs to sit somewhere exact. No AI request is involved.

1. Open the project and select **Style** in the canvas top bar, then click the element. A box with a move surface and resize handles appears around it, and the panel shows **Magnet**, size and **Position** sections.
2. Drag the element. When an edge or its center meets a neighbor, its container, the slide or artboard, a grid line, or a gap that matches the gap between two neighbors, it locks there. A guide line with a short label such as `left` or `24 px` shows what it locked to, and the **Magnet** section says the same in a sentence.
3. To place it freely, hold **Ctrl** (Windows, Linux) or **Command** (macOS) while dragging, or switch off **Magnet** in the canvas top bar (inside **More** on narrow windows). The choice is remembered on this computer.
4. Fine-tune with the keyboard: the arrow keys move the element 1 px, **Shift** with an arrow 10 px, and **Alt** or **Option** with an arrow jumps to the next line in that direction. A run of key presses is saved once, as one undo step. Or type exact values in **X** and **Y**, select one of the six **Align to parent** buttons, or select **Reset position** to put the element back where the page lays it out.
5. The resize handles lock the same way: the moving edge locks to nearby lines, and the width or height locks to a neighbor's size, which the badge names. The rotate handle locks every 15 degrees.
6. Press **Esc** to cancel a drag in progress. After a change, **Undo** in the top bar or Ctrl/Cmd+Z reverts it, and **Save history** lists every saved point.

A move is stored as a CSS `translate` offset on that one element. Its neighbors keep their places, and the offset applies at every screen width, so check a website's **Tablet 768** and **Phone 390** previews after moving something. An element whose position was authored in a unit other than pixels is left alone: its **X** and **Y** fields are disabled and say why. If the file changes while you are still dragging, for example because an AI turn finishes, the move is refused and the canvas shows the saved state.

## Move a project to another Mac

1. Finish generating and saving on the first Mac. Open the project and select **Download project backup** (located inside **More** on narrower windows) to save a `.burnguard-project` file.
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
