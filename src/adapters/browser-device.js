/**
 * Browser features the view offers as buttons: sharing a result and going full screen.
 * Each is optional; the view hides the button where the feature is missing.
 */
export class BrowserDevice {
  /**
   * @param {object} options
   * @param {{ share?: (data: { title: string, text: string, url: string }) => Promise<void>, clipboard?: { writeText: (text: string) => Promise<void> } }} options.navigator
   * @param {{ documentElement: { requestFullscreen?: () => Promise<void> }, fullscreenElement?: Element | null, exitFullscreen?: () => Promise<void> }} options.document
   * @param {{ href: string }} options.location
   */
  constructor({ navigator, document, location }) {
    this.navigator = navigator;
    this.document = document;
    this.location = location;
  }

  get canShare() {
    return typeof this.navigator.share === 'function' || typeof this.navigator.clipboard?.writeText === 'function';
  }

  get canFullscreen() {
    return typeof this.document.documentElement.requestFullscreen === 'function';
  }

  /**
   * Shares through the system sheet where there is one, else copies the text.
   *
   * @param {string} text
   * @returns {Promise<'shared' | 'copied' | 'failed'>}
   */
  async share(text) {
    const url = this.location.href.split('#')[0];

    if (typeof this.navigator.share === 'function') {
      try {
        await this.navigator.share({ title: 'Ping Pong Architecture Lab', text, url });
        return 'shared';
      } catch {
        // Cancelled or unavailable: fall through to the clipboard.
      }
    }

    try {
      await this.navigator.clipboard?.writeText(`${text} ${url}`);
      return 'copied';
    } catch {
      return 'failed';
    }
  }

  async toggleFullscreen() {
    try {
      if (this.document.fullscreenElement) {
        await this.document.exitFullscreen?.();
      } else {
        await this.document.documentElement.requestFullscreen?.();
      }
    } catch {
      // Refused (for example inside an iframe): nothing to do.
    }
  }
}
