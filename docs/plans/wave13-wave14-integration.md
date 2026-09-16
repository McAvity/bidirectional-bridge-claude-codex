# Wave13/wave14 — wspólna integracja

Data: 2026-09-16. Autoryzacja: użytkownik zlecił integrację po odbiorach obu dostaw.
Branch: waves13-14-integration. Główna baza: f80c0c7.

## Źródła i zmiany

- Wave13 e5ec2707da92bb73a983cc9e4ba59e6c8c3d1911, odebrane, bridge accepted.
- Wave14 50458be6463f71e4ba683fe90155d00b7edd080b, odebrany zakres niezależny.
- Review koordynatora 0109643; zachowane wraz z historią źródeł.
- eba3381 scala wave13; dbc724b scala wave14 i łączy mechanizmy.
- 50e274e wprowadza pin integracji; końcowy pin to 187fd3b z poprawką FIFO.

Konflikty launchera/MCP rozstrzygnięte z zachowaniem autoryzacji każdej operacji,
loggera oraz przygotowania worktree dopiero przy uprawnionej mutacji.
Hook używa stabilnej tożsamości callbacka mimo kontekstu tworzonego dla każdego
wywołania. Metadane dystrybucji przechodzą osobną projekcję do doctor.json w ZIP-ie:
wersje i pin, digest instrukcji, klasy lokalizacji, skonfigurowany plugin oraz
osobne niewiadome obserwacje. Nie uruchamia się kodu diagnozowanego projektu.
Odczyty nowych plików metadanych są ograniczone i odmawiają symlinków.
Rozpoznanie dispatchera używa rzeczywistego entry.mjs, a nie nieistniejącego dispatch.mjs.
Generator dołącza zależności diagnostyki do CLI pluginu.

## Walidacja — PASS na afe1bd8

Instalacja npm ci --ignore-scripts i build PASS. Python:46, pilot-tooling:140 PASS.
Pakiety zgodne ze źródłami; kontrola144 dokumentów i diff PASS.
Niezależne review integracji: PASS po poprawce INT-R1 w 187fd3b.
Potwierdzona blokada FIFO przy odczycie metadanych usunięta przez O_NONBLOCK;
niezależna reprodukcja i 3 testy projekcji/doctora PASS.
Pierwszy pełny przebieg JS: 532 PASS / 4 FAIL. Jeden błąd dotyczył asercji
liczącej techniczne sidecary SQLite; trzy testów rollbacku odwołujących się do
HEAD zmienionego podczas korekty. Test łączny po poprawieniu asercji PASS.
Porównanie wersji testów przypięto do runtimeCommit. Finalny pełny przebieg:
**536/536 JS, 46/46 Python, 140/140 pilot-tooling PASS**. Build, packages:check,
146 dokumentów i git diff --check PASS. Kod zamrożony na afe1bd8; późniejsze
zmiany dotyczą wyłącznie statusów i niniejszego raportu.
Nowy test łączny używa rzeczywiście zainstalowanego runtime, nowego worktree,
autoryzowanej operacji MCP, normalnego zamknięcia i eksportu z metadanymi pluginu.
To test bez modeli, nie nowy pilot Astry i Claude'a.

## Granice i następny krok

Nie przełączono aktywnego runtime, nie wdrożono do projektów użytkownika i nie
zmieniono prywatnych baz ani konfiguracji. Nie wykonano push ani publikacji marketplace.
Testy i niezależne review zakończone. Wynik scalany do feature-workflow przez
fast-forward; nie oznacza to wdrożenia ani publikacji.
Odbiór niezależnej części wave14 jest zachowany; nie zastępuje odbioru wspólnego wyniku.
Nie wywoływać feature_accept z innego managera w bazie oryginalnego wave14.
Wave15 nadal DRAFT; nie implementowano jego zakresu.

## Wydanie i aktywacja — 2026-09-16

Użytkownik odebrał wspólny wynik i jawnie autoryzował publikację na publicznym
McAvity/bidirectional-bridge-claude-codex, branch feature-workflow.
Opublikowane ca9895a zawiera README z instalacją przez marketplace i poprawiony
workflow CI: pełna historia do testów starszych runtime, Codex0.154.0 do kontroli
CLI bez logowania/inferencji, sprawdzanie wygenerowanych pakietów i dokumentów.
Wcześniejszy CI35119998820 na ab8ce87 nie przeszedł m.in. z powodu płytkiego klonu,
który nie zawierał rodzica używanego przez testy rollbacku. To poprawiono w ca9895a.

Nowy runtime0.2.0-187fd3b29206 zainstalowany obok starego. Plan update dla bieżącego
projektu ma jedną zmianę — current — i zero konfliktów. Aktualizację blokuje
ACTIVE_SESSION: istnieją działające klienty oraz procesy bridge’a z otwartą bazą.
Wybrany runtime nadal0.2.0-860e2e77d95f. Przygotowano lokalny, nieśledzony skrypt
aktywacji: update --yes, potem doctor; do wykonania po normalnym zamknięciu klientów.
Brak podmiany działającego runtime, resetu bazy lub zmian innych projektów.

CI na opublikowanym ca9895a: **SUCCESS**,
[GitHub Actions35120711465](https://github.com/McAvity/bidirectional-bridge-claude-codex/actions/runs/35120711465).
Build, wszystkie testy JS/Python/pilot, pakiety i dokumentacja przeszły.
Końcowy commit statusów jest wyłącznie dokumentacyjny i nie zmienia testowanego kodu;
nie uruchamia ponownie identycznego zestawu CI.
