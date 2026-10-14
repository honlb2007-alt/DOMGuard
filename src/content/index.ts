// TODO: Content-script entry. Injected on demand via chrome.scripting.executeScript
// from the popup (activeTab), not via manifest content_scripts.

import './scanner';
import './masker';
import './hidden-text';
import './picker';
