export const SETTINGS_SECTION_IDS = ["user", "generation", "runtime", "appearance", "files", "connections"] as const;
export type SettingsSectionId = (typeof SETTINGS_SECTION_IDS)[number];

export interface SectionOffset {
  readonly id: SettingsSectionId;
  /** Distance in px from the top edge of the scroll pane to the top edge of the section (negative once scrolled past). */
  readonly top: number;
}

export const SECTION_ACTIVATION_OFFSET = 48;

/** The section a reader is looking at: the last one whose top has reached the activation line, or the last one once the pane is scrolled to its end. */
export function activeSettingsSection(sections: readonly SectionOffset[], atEnd: boolean): SettingsSectionId | null {
  const first = sections[0];
  if (first === undefined) return null;
  if (atEnd) return sections[sections.length - 1]?.id ?? first.id;
  let active = first.id;
  for (const section of sections) {
    if (section.top <= SECTION_ACTIVATION_OFFSET) active = section.id;
  }
  return active;
}
