<h1 align="center">ReadParty</h1>

<p align="center">Read the same book together, in sync, from different devices.</p>

<p align="center"><a href="docs/media/readparty-demo.mp4"><img src="docs/media/readparty-demo.webp" width="360" alt="ReadParty demo video, playing silently with captions"></a><br><sub><a href="docs/media/readparty-demo.mp4">Watch with sound</a> · book: <i>Pride and Prejudice</i>, Project Gutenberg eBook #42671</sub></p>

<p align="center"><b><a href="https://readparty-app.netlify.app/#/party">readparty-app.netlify.app</a></b></p>

ReadParty adds a watch-party mode to [Koodo Reader](https://github.com/koodo-reader/koodo-reader), an open-source
EPUB reader. It was built for a long-distance reading date: each person reads the same book on their own screen,
sees the others' chapter and progress change as they turn pages, and can tap **Join** to jump to someone's page.

- Rooms hold up to 8 readers, each with a name and an emoji, and are joined with a 3-character code or an invite link.
- Highlights and notes made in a room appear in everyone's copy, attributed to the reader who made them.
- Positions are synced as a place in the text rather than in pixels, so different fonts and screen sizes land on the same passage.
- There is no account: each browser gets a random id. The backend is Supabase (Postgres, Realtime and Storage).

The feature is a set of new files under `src/utils/sync/`, `src/containers/readParty/`, `src/components/readPartyGuide/`
and `src/pages/party/`, plus small edits to Koodo's own files, so upstream changes can still be merged.
[`context.md`](context.md) explains the design, the backend and how to run it locally. Like Koodo Reader, this fork
is licensed under the AGPL-3.0.

---

<div align="left">

[简体中文](https://github.com/koodo-reader/koodo-reader/blob/master/README_cn.md) | [हिंदी](https://github.com/koodo-reader/koodo-reader/blob/master/README_hi.md)
|[Português](https://github.com/koodo-reader/koodo-reader/blob/master/README_pt.md) | [Indonesian](https://github.com/koodo-reader/koodo-reader/blob/master/README_id.md) | English

</div>

<div align="center" >
  <img src="https://dl.koodoreader.com/screenshots/logo.png" width="96px" height="96px"/>
</div>

<h1 align="center">
  Koodo Reader
</h1>

<h3 align="center">
  A cross-platform ebook reader
</h3>
<div align="center">

[Download](https://koodoreader.com/en) | [Preview](https://web.koodoreader.com) | [Roadmap](https://koodoreader.com/en/roadmap) | [Document](https://koodoreader.com/en/document) | [Plugins](https://koodoreader.com/en/plugin)

</div>

## Preview

<div align="center">
  <br/>
  <br/>
  <img src="https://dl.koodoreader.com/screenshots/7.png" width="800px">
  <br/>
  <br/>
  <img src="https://dl.koodoreader.com/screenshots/8.png" width="800px">
  <br/>
  <br/>
</div>

## Features

- Format support:
  - EPUB (**.epub**)
  - PDF (**.pdf**)
  - DRM-free Mobipocket (**.mobi**) and Kindle (**.azw3**, **.azw**)
  - Plain-text (**.txt**)
  - FictionBook (**.fb2**)
  - Comic book archive (**.cbr**, **.cbz**, **.cbt**, **.cb7**)
  - Rich text (**.md**, **.docx**)
  - HyperText (**.html**, **.xml**, **.xhtml**, **.mhtml**, **.htm**)
- Platform support: **Windows**, **macOS**, **Linux**, **Android**, **iOS** and **Web**
- Sync and backup your data with **OneDrive**, **Google Drive**, **Dropbox**, **iCloud**, **MEGA**, **pCloud**, **Yandex Disk**, **Box**, **FTP**, **SFTP**, **WebDAV**, **SMB**, or **Object Storage**
- Easily import books from **OneDrive**, **Google Drive**, **MEGA**, **Yandex Disk**, **Box**, **FTP**, **SFTP**, **WebDAV**, **SMB**, or **Object Storage**
- Use your custom AI model to power AI Translation, AI Dictionary, AI Summarization, and AI Encyclopedia
- Sync reading progress with **KOReader**
- Sync notes and highlights to **Readwise**, **Notion**, **Obsidian**, **Joplin**, and more
- Support local MDX dictionary lookup
- Automatically sync words to **Anki** and **Eudic**
- Protect your library with password, PIN, Windows Hello, Touch ID, and more
- One-click export of all books
- One-click export of notes and highlights, supporting **CSV**, **Markdown**, **HTML**, **TXT**, and **PDF**
- Privacy-first design: no tracking services, and no proactive uploading of your reading data or personal information
- Support **OPDS** protocol and share your library as an **OPDS** feed
- Support browser extension to save anything on the web to your library
- Built-in 50+ plugins for translation, dictionaries, and text-to-speech, with support for custom plugins
- Support vertical layout book
- Support reading statistics
- Built-in **Paddle** and **Tesseract** OCR engines
- Support library snapshots and version control
- Single-column, two-column or continuous scrolling layouts
- Text-to-speech, translation, dictionary, touch screen support, and batch import
- Add bookmarks, notes, and highlights to your books
- Adjust font size, font family, line-spacing, paragraph spacing, background color, text color, margins, and brightness
- Night mode and theme color
- Text highlighting, underline, boldness, italics, and shadow

## Installation

### Desktop version: [Download](https://koodoreader.com/en/download)

### Web version：[Visit](https://web.koodoreader.com)

### Android version：[Download](https://koodoreader.com/en/download)

### iOS version：[Download](https://koodoreader.com/en/download)

### Browser extension：[Download](https://www.koodoreader.com/en/use-extension)

### Install with Scoop:

```shell
scoop bucket add extras
scoop install extras/koodo-reader
```

### Install with Homebrew:

```shell
brew install --cask koodo-reader
```

### Install with Docker:

[Installation Guide](https://koodoreader.com/en/deploy-docker)

## Screenshot

<div align="center">
  <b>Book list</b>
  <br/>
  <br/>
  <kbd><img src="https://dl.koodoreader.com/screenshots/1.png" width="800px"></kbd>
  <br/>
  <br/>
  <b>Book display</b>
  <br/>
  <br/>
  <kbd><img src="https://dl.koodoreader.com/screenshots/5.png" width="800px"></kbd>
  <br/>
  <br/>
  <b>List mode</b>
  <br/>
  <br/>
  <kbd><img src="https://dl.koodoreader.com/screenshots/2.png" width="800px"></kbd>
  <br/>
  <br/>
  <b>Cover mode</b>
  <br/>
  <br/>
  <kbd><img src="https://dl.koodoreader.com/screenshots/3.png" width="800px"></kbd>
  <br/>
  <br/>
  <b>Reader menu</b>
  <br/>
  <br/>
  <kbd><img src="https://dl.koodoreader.com/screenshots/6.png" width="800px"></kbd>
  <br/>
  <br/>
  <b>Dark mode</b>
  <br/>
  <br/>
  <kbd><img src="https://dl.koodoreader.com/screenshots/4.png" width="800px"></kbd>
  <br/>
</div>

## Develop

Make sure that you have installed yarn and git

1. Download the repo

   ```
   git clone https://github.com/koodo-reader/koodo-reader.git
   ```

2. Enter desktop mode

   ```
   yarn
   yarn dev
   ```

3. Enter web mode

   ```
   yarn
   yarn start
   ```

## Translation

### Edit current language

1. Select your target language from the following list.

2. Click the view button to examine the source file. The untranslated terms are listed at the bottom of each file.

3. Translate the terms to your target language based on the given English reference

4. Submit the translation file or just translation snippets based on the amount of your translation to [this link](https://github.com/koodo-reader/koodo-reader/issues/new?assignees=&labels=submit+translation&projects=&template=submit_translation.yml). Pull request is also welcomed.

| Language(A-Z)   | Code  | View                                    |
| --------------- | ----- | --------------------------------------- |
| Amharic         | am    | [View](./src/assets/locales/am.json)    |
| Arabic          | ar    | [View](./src/assets/locales/ar.json)    |
| Armenian        | hy    | [View](./src/assets/locales/hy.json)    |
| Bengali         | bn    | [View](./src/assets/locales/bn.json)    |
| Bulgarian       | bg    | [View](./src/assets/locales/bg.json)    |
| Chinese (CN)    | zh-CN | [View](./src/assets/locales/zh-CN.json) |
| Chinese (MO)    | zh-MO | [View](./src/assets/locales/zh-MO.json) |
| Chinese (TW)    | zh-TW | [View](./src/assets/locales/zh-TW.json) |
| Czech           | cs    | [View](./src/assets/locales/cs.json)    |
| Danish          | da    | [View](./src/assets/locales/da.json)    |
| Dutch           | nl    | [View](./src/assets/locales/nl.json)    |
| English         | en    | [View](./src/assets/locales/en.json)    |
| Finnish         | fi    | [View](./src/assets/locales/fi.json)    |
| French          | fr    | [View](./src/assets/locales/fr.json)    |
| German          | de    | [View](./src/assets/locales/de.json)    |
| Greek           | el    | [View](./src/assets/locales/el.json)    |
| Hindi           | hi    | [View](./src/assets/locales/hi.json)    |
| Hungarian       | hu    | [View](./src/assets/locales/hu.json)    |
| Indonesian      | id    | [View](./src/assets/locales/id.json)    |
| Interlingue     | ie    | [View](./src/assets/locales/ie.json)    |
| Irish           | ga    | [View](./src/assets/locales/ga.json)    |
| Italian         | it    | [View](./src/assets/locales/it.json)    |
| Japanese        | ja    | [View](./src/assets/locales/ja.json)    |
| Korean          | ko    | [View](./src/assets/locales/ko.json)    |
| Persian         | fa    | [View](./src/assets/locales/fa.json)    |
| Polish          | pl    | [View](./src/assets/locales/pl.json)    |
| Portuguese      | pt    | [View](./src/assets/locales/pt.json)    |
| Portuguese (BR) | pt-BR | [View](./src/assets/locales/pt-BR.json) |
| Romanian        | ro    | [View](./src/assets/locales/ro.json)    |
| Russian         | ru    | [View](./src/assets/locales/ru.json)    |
| Slovenian       | sl    | [View](./src/assets/locales/sl.json)    |
| Spanish         | es    | [View](./src/assets/locales/es.json)    |
| Swedish         | sv    | [View](./src/assets/locales/sv.json)    |
| Tamil           | ta    | [View](./src/assets/locales/ta.json)    |
| Thai            | th    | [View](./src/assets/locales/th.json)    |
| Tagalog         | tl    | [View](./src/assets/locales/tl.json)    |
| Tibetan         | bo    | [View](./src/assets/locales/bo.json)    |
| Turkish         | tr    | [View](./src/assets/locales/tr.json)    |
| Ukrainian       | uk    | [View](./src/assets/locales/uk.json)    |
| Vietnamese      | vi    | [View](./src/assets/locales/vi.json)    |

### Add new language

1. If you can't find your target language from the above list, download the English source file from [this link](./src/assets/locales/en.json).

2. When you're finished translating, submit the source file to [this link](https://github.com/koodo-reader/koodo-reader/issues/new?assignees=&labels=submit+translation&projects=&template=submit_translation.yml). Pull requests are also welcome.
