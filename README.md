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

Okno aplikace smí na síť jen na ARES (CSP `connect-src https://ares.gov.cz`).
V Electronu dělá dotaz hlavní proces, ve webové verzi stránka sama.
