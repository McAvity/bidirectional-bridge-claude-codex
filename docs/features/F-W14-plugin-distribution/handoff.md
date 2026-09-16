# Wave14 — lokalna dostawa zakresu niezależnego

Status: **niezależna lokalna dostawa odebrana przez użytkownika** w `e76a06626046be6798ecde3bd57348605079e731`; [decyzja 03](decisions/03.md). Review koordynatora PASS: `0109643ca570acf989ec83139871a1ff5f1748be` na `waves13-14-review`. Cały wave14 pozostaje otwarty: integracja z finalnym wave13 i walidacja wspólnego wyniku należą do koordynatora. Nie wywołano feature_accept.

Kod dostawy: `1880b3914f4dd3bffe2a618e01f43b4d6281ac81`. Dystrybucja przypina runtime `87cceed8d08c298ce2976aa3ce9bec771dea31fe`. Implementacja: Claude przez jedną sesję bridge; niezależny review i reprodukcje: Codex. [Review i zamknięte znaleziska](reviews/02-implementation.md), [dowody walidacji](reviews/manager-validation.json), [postęp](../../plans/wave14-progress.md).

## Dostarczone

- Kod, generowane pluginy Codexa/Claude’a oraz oba manifesty marketplace są w tym repo; źródła skilli wspólne, kontrolowane przez `npm run packages:check`.
- Skill włącza projekt i instaluje przypięty runtime; ogólne instrukcje/helpery pozostają w instalacji. Projekt przechowuje przenośną deklarację, mały entrypoint i konfigurację MCP.
- Nowy worktree dziedziczy wejście i startuje bez init. Własny stan powstaje po autoryzowanej mutacji; odczyty są czyste, konkurencja nie przejmuje managera, przerwane przygotowanie można wznowić.
- Cache pluginu nie przełącza przypiętego zestawu. Migracja, update, rollback i doctor używają mechanizmów wave12; eksporter działa spoza docelowego repo.

[Instrukcja instalacji i eksploatacji](../../plugin-distribution.md), [setup](../../setup.md), [kontrakt](contracts/01-package-and-bootstrap.md). Na pierwsze włączenie projektu pozostają jawne zaufanie hosta i restart klienta. Późniejsze worktree nie wymaga własnego init.

## Walidacja

Niezależna czysta kopia `a01fbb6` (późniejszy 1880b39 zmienia tylko zapis liczników): `npm ci --ignore-scripts`, build, 486 testów JS, 43 testy Python, 140 testów narzędzi pilota, zgodność generowanych pakietów — PASS. Node 24.15.0, Python 3.12.3, Codex 0.154.0, Claude 2.1.273.

Na rzeczywistym, osobno zainstalowanym pinie 87cceed: pięć przerwań procesu z odtworzeniem stanu, porównanie bajtów po odczytach, jeden właściciel przy dwóch pierwszych użyciach jednego worktree — PASS. Interaktywny Codex pokazuje 35 narzędzi i skill pluginu, bez modelowej tury i bez utworzenia stanu przy samym starcie. Walidacja produktu nie uruchamiała modeli.

Źródło przypiętego commitu jest obecnie lokalne; instalacja z lokalnego źródła i pobieranie dokładnego SHA z niezależnego lokalnego Git zostały sprawdzone. Dostępność tego commitu publicznie nie jest potwierdzona — nie wykonywano publikacji.

## Wave13

Roboczy kod eksportera: `cf2365c3d473be2c7119d0682b85b70e155ec661`. Review: `853302cdf821671020e11f2a74c2406f33a68b75`, werdykt REWORK. To zamrożone źródła roboczego kontraktu, **nie odebrana baza integracyjna**.

Doctor podaje bezpieczne tożsamości pakietu/runtime/instrukcji; fakty skonfigurowane i obserwowane są rozdzielone, nieznane wartości są null. Obecny projektor wave13 odrzuca dowolne dodatki top-level doctor, dlatego `doctor.distribution` samo nie jest integracją diagnose. Po odbiorze wave13 trzeba zapisać jego zaakceptowany commit, uzgodnić jawnie dozwolone pola i wykonać wspólne testy. Żaden kod wave13 nie został tu dołączony.

## Opcjonalny smoke — propozycja, nie uruchomiono

Osobny zakres: izolowana instalacja pluginu, nowe repo, jedno włączenie skillem, nowy zewnętrzny worktree, zwykły Codex i jedna delegacja do Claude’a z review. Bez ponawiania wave10 i bez realnych danych użytkownika.

Proponowany budżet: do 20 minut, jedna runda Claude’a do 12 tur, do 10 USD kosztu raportowanego przez runtime dla całej próby; operator kończy po pierwszym osiągniętym limicie. Raport runtime nie jest potwierdzeniem faktycznego rozliczenia. Wymaga osobnej zgody na ten zakres i budżet; obecne zlecenie jej nie udziela.

Wszystkie commity są lokalne. Bez push, merge, wdrożenia, zmiany worktree wave13 lub przełączenia aktywnego runtime. Niezależna dostawa jest odebrana; integracja i wspólne testy finalnego wave13 pozostają do wykonania przez koordynatora. Końcowy checkpoint tej sesji jest wyłącznie dokumentacyjny, bez nowych review i testów; dowody i paczki zachowano.

Końcowy pakiet: `F-W14-local-delivery.zip`, cel `implementation-review`, baza kodu `1cd1be78e3c18d5155b45d9dd95c27bd2a663c14`; zapisany w namespace exchange tego worktree. Manifest pakietu identyfikuje końcowy commit koordynatora i hashe dokumentów.
