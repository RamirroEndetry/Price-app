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
| `preload.js`  | bezpečný most mezi oknem a hlavním procesem                   |
| `renderer.js` | logika tabulky, výpočty, HTML pro e-mail, ukládání            |
| `index.html`  | rozložení aplikace                                            |
| `style.css`   | vzhled                                                        |

Okno aplikace nemá přístup k síti (CSP `connect-src 'none'`); jediný síťový
dotaz, vyhledání v ARES, dělá hlavní proces.
