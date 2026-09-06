export type KiroSessionNotificationSource = 'extension' | 'standard';

interface MirrorCandidate {
  fingerprint: string;
  source: KiroSessionNotificationSource;
}

export class KiroSessionNotificationMirrorDeduplicator {
  private candidate: MirrorCandidate | null = null;

  shouldProcess(notification: unknown, source: KiroSessionNotificationSource): boolean {
    const fingerprint = this.createFingerprint(notification);
    if (!fingerprint) {
      this.candidate = null;
      return true;
    }

    if (this.candidate?.fingerprint === fingerprint && this.candidate.source !== source) {
      this.candidate = null;
      return false;
    }
    this.candidate = { fingerprint, source };
    return true;
  }

  reset(): void {
    this.candidate = null;
  }

  private createFingerprint(notification: unknown): string | null {
    try {
      return JSON.stringify(notification) ?? null;
    } catch {
      return null;
    }
  }
}
