# Wave16 — review planu, 2026-09-19

## PASS — brak wymaganych poprawek

Plan jest gotowy do osobnego zlecenia wykonania, zaczynając od W16-01.
Uproszczenie usuwa obowiązkowy transport ZIP między agentami współdzielącymi repo,
zachowując kontrolę pochodzenia dostawy, zakresu, dowodów oraz rzeczywistą akceptację.
Poniższe dwie uwagi są wejściem do istniejących zadań, nie nowymi bramkami.
PASS dotyczy planu, nie implementacji ani odbioru użytkownika.

## Wejście, niezależność i zakres

Plan: [wave16.md](../../wave16.md) na
`9b4a1ecc410b0307fab557229703c48b17ebdf3b`.
SHA-256 planu: `71adac1a9cd56084db508107ace00d963d28a4728b90173d2de6a6ddcb8a58c7`.
Baza techniczna planu: 3a3afdd. Zakres zapisu planu: 3a3afdd..9b4a1ec.

Niezależną ocenę wykonał agent wave16_plan_review, który nie pisał planu.
Koordynator będący autorem planu sprawdził dodatkowo ścieżkę wyniku adaptera i zapisał
niniejszy raport; nie przedstawia własnej kontroli jako niezależnego review.
Przeczytano plan/progress, AGENTS/HANDOFF/wave7, shared workflow, skille execute,
exchange i review, bridge-loop oraz relewantny kod typów, artefaktów i runnera Claude.
Nie uruchamiano wykonawców przez bridge ani smoke; nie zmieniano skilli, kodu lub planu.

## Uzasadnienie

- Cel i podział ról są jednoznaczne (plan:9–21,42–55). Wykonawca realizuje task,
  koordynator odbiera i recenzuje, exchange pozostaje opcjonalnym przekazaniem.
- Kontrole bazy/head, zakresu, dirty tree i obcych commitów pozostają wymagane
  (64–82). Dostarczony SHA jest odróżniony od bieżącej integracji.
- W16-01 ma przygotować konkretne mapowanie wyniku i reguły zgodności przed
  implementacją (59–62,95–114). Brak gotowego kontraktu nie blokuje zadania,
  którego wynikiem ma być właśnie ten kontrakt.
- W16-02/03 pokrywają AC-01…08. Chronione są namespace, intent/replay wave15,
  historyczne kontrakty i dowody. Kopie pluginów aktualizuje generator.
- Plan odróżnia regresje bez modeli od przyszłego smoke (131–142); nie zalicza
  wcześniejszych zobowiązań wave15 i nie uruchamia dodatkowych eksperymentów.

## R16-N1 — mapowanie przez rzeczywisty adapter

Dyspozycja: uwaga nieblokująca, wejście do W16-01 / AC-02.

Typ `Deliverable` ma pole `commit_or_diff` (shared/protocol/src/types.ts:405–420),
ale `claude/claude-side/src/adapters/claude-code-runner.ts:1044` ustawia je na null.
Runner ma własny `ClaudeStructuredOutput`; summary ogranicza do4000 znaków,
a długi wynik zachowuje jako artefakty raportu.

Samo wymaganie dowolnego pola w JSON wykonawcy może zgubić metadane przy normalizacji.
Mapowanie i przykłady W16-01 muszą wskazać faktycznie zachowywane pola/artefakty oraz
ich odczyt przez Astrę. To realizacja istniejącego wymagania planu59–62, nie powód do
rozszerzenia protokołu z góry. Dowód dostawy powinien obejmować tę ścieżkę normalizacji.

## R16-N2 — techniczne pokrycie a zachowanie modeli

Dyspozycja: uwaga nieblokująca do raportu W16-03.

AC-01/04/05 opisują działania agentów, natomiast smoke jest osobno zlecany.
Test tekstu instrukcji lub syntetycznego przepływu nie dowodzi, że model zaprzestanie
eksportowania ZIP i poprawnie odbierze lokalną dostawę. Raport końcowy ma oddzielnie
nazwać pokrycie mechaniczne i niezweryfikowaną część behawioralną, zgodnie z planem.
Nie jest to żądanie smoke teraz ani nowa bramka przed W16-01.

## Walidacja i następny krok

Kontrola odsyłaczy dokumentacji i git diff --check: PASS. Nie uruchamiano testów
implementacji dla planu. Brak wymaganych korekt; nie utworzono dodatkowego reviewera
ani obowiązku ponownego ogólnego review. Następny krok to osobne zlecenie wykonania
wave16 z niniejszymi uwagami jako kontekstem W16-01/W16-03.
