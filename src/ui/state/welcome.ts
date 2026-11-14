export type SectionId = 'direct' | 'install' | 'upload' | 'demo';

/** Which welcome section is open when the page opens. */
export const defaultSection = (directAccess: boolean): SectionId => (directAccess ? 'direct' : 'upload');

/** The sections that need the browser's direct file access (Chrome, Edge). */
export const isSectionDisabled = (id: SectionId, directAccess: boolean): boolean => !directAccess && (id === 'direct' || id === 'install');

/** A failed pick is explained inside the section the pick started from. */
export const problemSection = (source: 'direct' | 'upload' | null): SectionId => (source === 'upload' ? 'upload' : 'direct');
