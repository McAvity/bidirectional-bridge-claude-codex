# Review 01 — plan F-W18

## Executive summary

**PASS.** Plan obejmuje cel briefu; brak wymaganych poprawek i blockerów.
Rekomendacja: feature-decide, następnie odrębne zlecenie wykonania.
W18-01 pozostaje lokalną bramką kontraktową przed W18-02, nie kolejnym odbiorem
użytkownika. PASS dotyczy planu, nie implementacji ani spełnienia AC przez produkt.

## Niezależność, wejścia i zakres

Data: 2026-10-20. Niezależne review wykonał osobny agent `w18_plan_review`, który
nie pisał planu ani nie edytował plików. Autor planu/koordynator zapisał jego wynik
oraz wykonał kontrole strukturalne. Nie przedstawiamy samokontroli autora jako
niezależnego review. Reviewer pracował bez dalszej delegacji.

Wejście: `ed61373e0989aa9af6f3d9128bbb202990d1d784`, branch design/feature-closure.
Kod bazowy planu: `6433d2b828f04a7ea74dbf4d7709958cd4d5cc5c`;
commit planu zmienia wyłącznie dokumenty. Worktree przed review czysty.

| Plik | SHA-256 |
| --- | --- |
| brief.md | `7bc1c446d47edd97803a4be935d111b2eb540ca93ac2777989367fac25004c5c` |
| design.md | `35564a49af99f4d2ae33929d0f813af243e90ba3673faaa41c9fd739daab41bc` |
| work-items/W18-01.md | `3662579f67d0b0938ed8091e78c3dae3fd4932e09c1c1911601bfae5eb094428` |
| work-items/W18-02.md | `a486bd4c0fdd7339a7215adbaaceddfe57ea2b405a7e3ae373c24730463e916b` |
| work-items/W18-03.md | `a038fced2fd0e417ed39664d14992ebc70616a55795e7308d76dc418558d5e0b` |

Przeczytano brief, design, indeks, trzy taski oraz istotne źródła lifecycle,
MCP, slotu, recovery i migracji. Numery linii poniżej dotyczą wskazanego wejścia.

## Ustalenia

Brak findingów wymagających korekty. Plan nie rozszerza zakresu na zatrzymywanie
wykonawcy lub rollback kodu i nie zmienia REWORK w odrzucenie całego featura.

- Ponowienia: `shared/mcp-server-core/src/tools.ts:373` pokazuje istniejące
  zajęcie slotu przed accept. `design.md:49–59` świadomie wymaga replay bez
  ponownego zajęcia slotu i bez naruszenia nowego featura.
- Atomowość: `tools.ts:256` prowadzi synchroniczne mutacje przez runMutation,
  a `manager-registry.ts:453` zwalnia tylko wskazany slot. Plan wymaga wspólnej
  transakcji closure, stanu, idempotencji, koordynatora i slotu.
- Recovery: `orchestrator.ts:608–636` potwierdza konieczność zmiany więcej niż
  feature_run. `design.md:71–80` obejmuje pełną macierz mutacji, rezerwacje,
  refresh/derive oraz późne reconciliation.
- Taski mają rzeczywiste zależności i rozdzielają kontrakt, implementację oraz
  integrację. Nie wymagają finalnego kontraktu przed taskiem, który go tworzy.
  Własność wspólnych plików i jedna kolejka wykonania są wykonalne.

### Dwa punkty do rozstrzygnięcia w już zaplanowanym W18-01

To przypomnienie zakresu kontraktu, nie nowe findingi ani bramki:

1. `sqlite-store.ts:319–341`: starszy attach/readonly odrzuca nowszy schemat,
   lecz initialize zapisuje własny numer bez tego warunku. Sam schema 6 nie
   zabezpiecza każdego starego konsumenta. Plan już to wskazuje (design:26–28,
   85–91; W18-01:15–18). Kontrakt ma rozdzielić wspierany launcher/setup/rollback
   od bezpośredniego starego API initialize; nowy guard nie dowodzi ochrony
   niezmienionego starego kodu.
2. `shared/protocol/src/types.ts:40–51`: VERIFYING nie prowadzi do CANCELLED.
   W18-01 rozstrzyga wąską ścieżkę i współdzielonego parenta (design:62–67).
   Historyczne DONE/FAILED zostają nienaruszone; nie wolno anulować koordynatora
   nadal używanego przez inny feature.

## Pokrycie wymagań przez plan

| AC | Pokrycie |
| --- | --- |
| 01–02 | Dwa wyniki terminalne, stany wejściowe, brak modelu; W18-01/02 |
| 03–04 | Zachowany odczyt/historia, transakcja slotu, replay po starcie B; W18-02/03 |
| 05–06 | Próby/lease, wyścigi rezerwacji i macierz wszystkich mutacji; W18-01/02 |
| 07 | Natywna tożsamość/worktree i regresje foreign identity; W18-02 |
| 08 | Zachowanie kodu/wyników, prawdziwy wynik koordynacji; wszystkie taski |
| 09 | Migracja danych 0.4.3, stare tryby otwarcia i rollback; W18-01/02 |
| 10–11 | Decyzja kontra REWORK/pauza, standalone, stary runtime, diagram/pakiety; W18-03 |

To pokrycie zaplanowaną pracą, nie dowód implementacji. Kontrakt W18-01 jeszcze
nie istnieje, zgodnie z kolejnością dostawy.

## Kontrole i ograniczenia

Koordynator: kontrola odsyłaczy PASS (217 plików przed dodaniem review), JSON i
istnienie wszystkich zarejestrowanych ścieżek PASS, unikalne taski PASS,
git diff --check PASS. Reviewer sprawdził źródła wskazanych ryzyk.
Nie uruchamiano testów produktu, migracji ani wykonawców/modeli przez bridge.
Nie odczytywano prywatnej bazy dnd5. Nie zmieniano briefu, projektu, tasków ani kodu.

Następny krok: `$feature-decide F-W18` na tym branchu. Decyzja i zlecenie
implementacji nie wynikają automatycznie z PASS.
