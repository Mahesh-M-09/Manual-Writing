# Works Capture — three document types

Tablet-friendly capture app. Serve this folder from a local or static web server. No build step or API key is needed. Use the same browser and URL to reopen your library.

New manual offers Works Manual, Temporary Work Procedure (TWP), and Visual Aid (VA). No example manuals or production values are included.

- Works Manual retains the original front matter, safety symbols, quality points and numbered procedure.
- TWP adds operation, factory location, start/end dates, approval details and training records, using the uploaded template structure. Add pictures to the cover or any procedure step.
- VA offers A4 (default), A3 or A5, portrait or landscape. Each panel supports text, pictures and editable tables; each section starts on a new sheet.
- The shared picture editor supports moving/resizing marks, undo/redo, arrows, boxes, notes, crop and rotate.
- Export offers Word and PDF. PDF uses the browser print dialog: choose Save as PDF, match the selected paper size/orientation and disable browser headers/footers. Word includes repeating document headers. Pagination can differ between Word and browser PDF.
- Procedure starts on a new page, with its first chapter; subsequent chapters start on new pages.
- Word contents fields may need updating in Word.

All captured text and media are stored in this browser's IndexedDB. Library backups include editable annotations, photos, recordings and tables. Use Back up all, or an individual card's Backup, before changing devices or clearing browser data. Existing milestone-one backups remain supported. Number allocation is local, not a shared company register.

No AI service or business-account connection is required. Audio/video stays in the editable backup; written notes appear in exports, not playable recordings. Template approval fields record what you enter and do not provide a digital approval workflow.

Update the application files together (including templates.js). Existing saved data is retained on the same origin. Remove obsolete example files when updating an older installation. docx.js is distributed with DOCX-LICENSE.

## Import existing Word files
Use Library → Import Word, choose the output type, select a .docx file in the visible file control, then tap Import manual. Body text, headings, ordinary tables and supported embedded pictures are converted into editable capture sections. Recognised Scope, Overview, Safety, Quality and Risk Assessment headings populate the matching fields for WM/TWP. Other text remains in procedure sections. All three document types allow editable tables.

Conversion is a draft, not pixel-perfect Word editing. Review the import report: merged/nested tables are flattened, large tables split, source headers/footers/comments/footnotes omitted, tracked changes flattened, and vector images/charts/embedded objects may require manual replacement. No OCR is performed. Save old .doc or protected documents as an unprotected .docx in Word before import. The source document is unchanged.

## Tables and Excel
In any step/panel, choose + Table or Paste from Excel. Copy a rectangular range in Excel and paste into the dialog; the first row supplies column headings. You can edit cells and add/remove rows or columns. A table supports 8 columns and 100 data rows; split bigger ranges. Pasted formulas become the displayed values. Tables are stored in backups and included in Word/PDF.

## Publish on GitHub Pages
1. Extract this ZIP and upload all its files to a repository root (index.html must be at the root).
2. In the repository, open Settings → Pages. Select Deploy from a branch, then main and /(root), and Save.
3. Open the Pages URL GitHub gives you. Use that same URL/browser to keep accessing the same saved library.

The hosted application code may be public depending on your repository/Pages settings. Captured documents are browser-local and are not committed to GitHub. Do not put private manufacturing manuals, backup JSON files or recordings in the repository.

For local use: run `python3 -m http.server 8000` inside the extracted folder and open http://localhost:8000. Camera, microphone, clipboard and screen capture depend on browser/device support and permission.

Third-party library licences: DOCX-LICENSE and JSZIP-LICENSE.txt.

## Mobile editor, voice-to-text and choices

- **Picture editor:** Drawing or selecting a mark does not open the keyboard. Tap Edit note or Edit text when you want to type, then Apply & close keyboard. Zoom in/out and use Pan to move around the enlarged picture. Use Move for annotations, the arrow buttons for small adjustments, and Undo/Redo for corrections. Toolbars scroll horizontally on narrow phones.
- **Voice to text:** In a step, tap Voice to text. Choose Instruction, Quality, Safety or another field; tap Start listening, speak, then Stop. Review the transcript and tap Add text to step. It appends to existing text. Audio attachment is separate and still stores a recording.
- **Speech availability/privacy:** Browser speech recognition may send audio to the browser vendor's speech service and may need internet access. It uses no Works Capture AI API or tokens. Support and microphone permissions vary; use the keyboard microphone button to dictate through your phone's keyboard if web speech is unavailable. Verify all technical values and units.
- **Older manuals:** Import Word is for .docx; Open saved draft is for Works Capture .json. Both dialogs now contain visible file selectors. A single restored JSON draft opens automatically. Older .doc files must first be saved as .docx in Word.
- **Areas and codes:** Library → Settings & choices. Add a new area name and its code, or change a code already listed. Choose the area/code on a document's front page. Existing document numbers are not changed by editing settings.
- **Bike and other choices:** In Settings, enter one choice per line for bike type, type, applicability version, mark, speed, variants, line/station and reason; then Save choices. You can also choose Add a choice in a document dropdown. Older values remain available on their documents.
- **Moving settings to another device:** Back up all includes areas and choices. When opening that library backup, select Also restore areas and choices. These settings are local to your browser, not a company-wide catalogue.

Refresh the existing GitHub Pages URL to load updates. Do not clear browser storage to update the application; it holds your saved manuals.

Offline verification covers custom-area preservation, saved choices, dictation event handling, native import controls and Word export/import regression checks. Physical microphone recognition and virtual-keyboard behaviour still depend on the phone/browser and have not been tested on a physical iPhone/iPad.
