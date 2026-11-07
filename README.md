# Cenová tabulka

Generátor cenových nabídek pro e-mail (Electron, Windows). Vytvoříš tabulku
položek, doplníš údaje nabídky a jedním kliknutím ji zkopíruješ do schránky
jako HTML, které jde rovnou vložit do e-mailu. Umí i export do PDF a ukládání
nabídek do souboru.

## Funkce

- Režimy **Pronájem / Prodej / Barter** s přednastavenými položkami
- Ceny v CZK nebo EUR, DPH 21 / 12 / 0 %, slevy na řádek i na celek
- **Klient z ARES**: do pole Klient stačí napsat IČO nebo část názvu firmy
  a stisknout Enter, doplní se oficiální název, IČO, DIČ a sídlo
- Kopírování pro e-mail (HTML + prostý text), export do PDF
- Uložení a otevření nabídky (`*.nabidka.json`), automatické uložení
  rozpracované nabídky v rámci dne
- **Kalendář u dat** – datum jde psát ručně, nebo vybrat v kalendáři (ikonka
  v poli). Deinstalace se otevře v měsíci instalace, instalaci zvýrazní,
  dřívější dny nepustí a dobu akce podbarví; platnost se drží data vystavení.
  Výběr spustí stejné dopočty jako ruční zápis (počet dní, platnost +14 dní).
- **Lišta s akcemi** dole je pořád po ruce i s výslednou částkou (s DPH
  nebo bez, podle přepínače)
- **Vesmírný vzhled** sladěný s Generátorem objednávek: procedurální
  mlhovina, hvězdy a meteory (`sky.js`), skleněné panely, písma
  Bricolage Grotesque a JetBrains Mono přibalená ve složce `fonts/` (OFL)
- **Maskot** v horní liště – vlastní postavička v levandulové mikině s oušky na
  kapuci. Chvíli stojí, pak se stydlivě usměje, zamává a vrátí se do
  klidu; najetí myší animaci spustí hned. Animace je 5s průhledné video
  `assets/mascot-dance.webm` (vygenerované v Higgsfield z její předlohy na
  zeleném pozadí se stejným prvním i posledním snímkem, zelená vyříznutá
  ffmpegem do VP9 s alfa kanálem), klid je jeho první snímek `mascot-idle@Nx.png` v přesné velikosti pro
  každé měřítko obrazovky (`srcset`), aby ho prohlížeč nezmenšoval a nerozmazal.
  Řídí ho `mascot.js`, CSP proto povoluje `media-src 'self'`.

## Webová verze (GitHub Pages)

Stejná aplikace běží i v prohlížeči bez instalace:
<https://ramirroendetry.github.io/Price-app/>

Nasazuje ji GitHub Actions (`.github/workflows/pages.yml`) při každém pushi
do `main`; v nastavení repozitáře musí být *Settings → Pages → Source:
GitHub Actions*. Rozdíly proti Electronu:

- Kopírování pro e-mail používá schránku prohlížeče (`navigator.clipboard`).
- Uložení a otevření nabídky jde přes dialog prohlížeče (Chrome, Edge),
  jinde se soubor stáhne / vybere přes běžný výběr souboru.
- Export do PDF otevře nabídku v nové záložce a spustí tisk, kde zvolíš
  „Uložit jako PDF“.
- Klávesové zkratky (Ctrl+N, Ctrl+O, Ctrl+S, Ctrl+P, Ctrl+Enter) fungují i tady.

## Spuštění ze zdrojáků

Potřebuješ [Node.js](https://nodejs.org/) (LTS).

```bash
npm install
npm start
```

## Sestavení instalátoru

```bash
npm run dist
```

Instalátor `Cenova tabulka Setup <verze>.exe` vznikne ve složce `dist/`.
Přenosnou verzi bez instalace vytvoří `npm run dist:portable`.

## Struktura

| Soubor        | Co dělá                                                       |
| ------------- | ------------------------------------------------------------- |
| `main.js`     | hlavní proces: okno, menu, dialogy, PDF, schránka, dotaz na ARES |
| `ares.js`     | dotaz na ARES, sdílený Electronem i webovou verzí             |
| `web-api.js`  | náhrada propojení s Electronem pro běh v prohlížeči           |
| `preload.js`  | bezpečný most mezi oknem a hlavním procesem                   |
| `renderer.js` | logika tabulky, výpočty, HTML pro e-mail, ukládání            |
| `index.html`  | rozložení aplikace                                            |
| `style.css`   | vzhled                                                        |
| `sky.js`      | vesmírné pozadí (canvas), stejný generátor jako v Generátoru objednávek |
| `calendar.js` | kalendář k polím s datem                                      |
| `fonts/`      | přibalená písma (offline, CSP `font-src 'self'`)                  |

Okno aplikace smí na síť jen na ARES (CSP `connect-src https://ares.gov.cz`).
Hlavní proces přijímá IPC jen z hlavního rámu stránky aplikace, okno nesmí
navigovat jinam (ani po přetažení souboru) a „Ukázat ve složce“ funguje jen
pro soubory, které aplikace sama uložila.

Nové soubory je potřeba přidat do `build.files` v `package.json` (instalátor)
i do kroku „Připravit statické soubory“ v `.github/workflows/pages.yml` (web).
V Electronu dělá dotaz hlavní proces, ve webové verzi stránka sama.
