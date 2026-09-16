# Wave12 — instalacja, aktualizacje i doctor

Status: ODEBRANE przez użytkownika 2026-09-16 na branchu `wave12`; review W12-R1 zamknięte,
smoke AC-08 PASS; oczekuje integracji przez koordynatora. Plan: 2026-09-14.
Baza planowania: feature-workflow `1eae147`; wave10 i wave11 przyjęte oraz opublikowane.
Postęp: [wave12-progress.md](wave12-progress.md). Raport: [wave12-report.md](wave12-report.md).

## Cel i granice

W istniejącym projekcie użytkownik instaluje przypięty bridge i instrukcje, otwiera
wybrany worktree i uruchamia zwykłe `codex`. Astra może delegować Claude’owi przez
MCP bez ręcznego uruchamiania serwera i kopiowania długich flag. Błędy przygotowania
wyjaśnia doctor, bez uruchamiania modeli. Instalacja działa także dla rozwoju bridge’a.

Wariant v1: Linux, lokalny filesystem, jedna aktywna Astra/feature na worktree.
Osobne worktree Herdr, również poza checkoutem, mają niezależny stan i konfigurację
wyboru wersji. Mogą współdzielić wyłącznie niezmienne pliki tej samej wersji runtime.
Git metadata pozostają współdzielone zgodnie z mechaniką Git; nie są stanem bridge’a.
Nie zmieniamy zaakceptowanego protokołu izolacji ani workflowu featurów.

## Wejścia i rozpoznanie

Przeczytać aktualne HANDOFF, wave7, fork-setup, manager-identity, recovery, konfiguracje
klientów, launcher MCP i skille obu ról. Bazować na źródłach forka, nie archiwum ani
narzędziach pilota. Przy starcie przypiąć aktualny commit; zachować późniejsze zmiany.
Obecne wersje testowe: Node 24, Python 3.11+, adapter tożsamości Codex dokładnie 0.154.0.
Ustalić wspierane wersje z kodu i dowodów, nie z założenia, że najnowsze CLI jest zgodne.

Przed implementacją rozstrzygnąć małą liczbę kwestii technicznych:
- jak klient rozwiązuje cwd/ścieżki konfiguracji projektu w zwykłym repo i worktree;
- które instrukcje trafiają do Astry i Claude’a oraz jak klient je odkrywa;
- minimalny sposób instalacji wersji ze źródeł/artefaktu i wyboru jej przez workspace;
- sposób wykrywania aktywnego użycia, bez polegania na samym braku WAL/SHM.
Sprawdzić lokalnie konfiguracje/kod klientów; dokumentację oficjalną wykorzystać przy
brakujących faktach. Nie rozszerzać automatycznie zgodności adaptera na nowe hosty.
Zwykłe wybory techniczne rozstrzyga wykonawca; nie tworzyć osobnej fali kontraktów.

## Zakres wykonania

### 1. Wersjonowany runtime i minimalna dystrybucja

Dostarczyć jedno opisane wejście CLI, roboczo `bridge`, ze źródeł publicznego forka.
Wybrać najprostszy odtwarzalny wariant: instalacja przypiętego commitu lub artefaktu.
Nie wymagać publikacji npm ani budować jednocześnie kilku kanałów dystrybucji.
Manifest wiąże źródłowy commit, format instalacji, wersję runtime i zestaw instrukcji.
Build/install odbywa się poza projektem wykonawcy i aktywnym runtime. Instalacja nowej
wersji nie nadpisuje starej. Nie wybierać ruchomego HEAD/latest przy każdym starcie MCP.
Zachować historię upstream, MIT i komplet plików potrzebnych do odtworzenia wydania.

### 2. Init do istniejącego projektu

Roboczy interfejs: `bridge init --workspace <path>`; dokładne nazwy dobrać do istniejącego CLI.
Init przygotowuje konfigurację MCP, instrukcje i ignore’y, pokazując zakres zmian.
Domyślnie lokalnie dla projektu; bez modyfikacji osobistego profilu Codexa/Claude’a,
modelu, kluczy, rozliczeń, globalnego sandboxa i zgód na wykonywanie poleceń.
Nie niszczyć istniejących AGENTS.md, CLAUDE.md, konfiguracji ani lokalnych wersji skilli.
Obsłużyć pliki już istniejące: identyczne = no-op, własne niezmienione = zarządzalna
aktualizacja, obce/zmodyfikowane = konkretny konflikt. Bez szerokiego force-overwrite.
Ponowny init ma być idempotentny. Zmiany zastosować jako spójny zestaw lub zostawić
czytelny stan naprawy bez usuwania plików użytkownika.

Docelowo `cd <worktree>` i `codex`. MCP uruchamia się jako proces klienta.
Jeżeli test rzeczywistego klienta wykaże ograniczenie, dostarczyć jeden krótki wrapper
jako jawny fallback i opisać przyczynę. Nie zakładać z góry jego konieczności.

### 3. Herdr i niezależne worktree

Rozwiązywać rzeczywisty workspace i jego gitdir, nie główny checkout ani nazwę brancha.
Sprawdzić układ worktree poza repo, odpowiadający ~/.herdr/worktrees/bridge/<name>,
bez zależności instalatora od Herdr lub konkretnego katalogu domowego.
Po utworzeniu nowego worktree dopuszczalny jest pojedynczy idempotentny init.
Pliki wersjonowane projektu mogą być dziedziczone, ale lokalny wybór runtime, baza,
logi i paczki nie mogą przez to wskazać stanu innego worktree. Aktualizacja A nie
przełącza B. Nie kopiować .bridge między worktree i nie wykonywać cichej legacy adoption.
Użyć istniejącej tożsamości i resolvera namespace; nie tworzyć drugiego algorytmu.

### 4. Update i rollback

Robocze operacje `bridge update` i `bridge rollback` zmieniają wybór wersji oraz
zarządzane instrukcje wyłącznie dla wskazanego workspace. Przed zapisem pokażą diff,
sprawdzą lokalne modyfikacje i zgodność runtime/instrukcji/stanu.
Nie przełączać działającej sesji w połowie pracy; odmowa wskazuje, co normalnie zamknąć,
bez zabijania cudzych procesów. Przygotowanie nowej wersji może działać niezależnie.
Rollback nie przywraca starej kopii bazy i nie usuwa nowych zdarzeń. Jeśli format stanu
nie jest wstecznie zgodny, odmówić cofnięcia z konkretnym powodem. Nie obiecywać
rollbacku dowolnej przyszłej migracji; test obejmuje zadeklarowane zgodne wersje.

### 5. Doctor bez modeli

Roboczy interfejs `bridge doctor --workspace <path>`, wynik czytelny oraz JSON
z wersjonowanym formatem, stabilnymi kodami problemów i zalecanym następnym krokiem.
Sprawdza: wersje narzędzi/adaptera, kompletność przypiętego builda i instrukcji,
konfigurację MCP/cwd/timeouty, rozwiązywanie workspace, dostęp do własnych katalogów,
ryzyko pomieszania stanu oraz rzeczywisty handshake MCP bez delegacji.
Rozróżnia brak narzędzia, nieobsługiwanego hosta, problem sandboxa, brak konfiguracji,
konflikt właściciela i brak wystarczającego dowodu. Nie oznacza niezbadanego stanu jako OK.
Kontrole nie claimują managera, nie migrują bazy i nie uruchamiają recovery/modeli.
Tymczasowa próba zapisu dopuszczalna tylko w własnym katalogu diagnostycznym, usuwana
po kontroli; nie zmienia domenowego stanu featura. Brak logowania można zgłosić,
bez badania paneli opłat ani wymagania kolejnego potwierdzenia rozliczania.
Doctor nie naprawia automatycznie systemu, uprawnień lub tożsamości workspace.

## Wspólny punkt z wave13

Zapisać krótki kontrakt w dokumentacji setupu: manifest wersji, ścieżki konfiguracji,
stan/runtime per-worktree, istniejący namespace wymiany, miejsce na lokalne logi,
format/kody doctor. Rozdzielić dane lokalne od plików przeznaczonych do Git.
Wave13 wykorzysta ten układ do logowania, retencji i eksportu incydentów; wave12 nie
implementuje ich na zapas. Po ustaleniu tego punktu diagnostyka może ruszyć równolegle
w osobnym worktree z jasno rozdzielonym zakresem plików.

## Kryteria odbioru

| ID | Wymagany dowód |
| --- | --- |
| AC-01 | Świeży klon/artefakt wystarcza do instalacji; brak zależności od archiwum, /tmp pilota i maszyny autora. |
| AC-02 | W istniejącym projekcie init daje dostępne MCP i instrukcje obu ról; drugie init nie zmienia plików. |
| AC-03 | Własne konfiguracje/skille użytkownika są zachowane; konflikty i przerwany zapis mają czytelną obsługę. |
| AC-04 | Dwa zewnętrzne worktree mają niezależne ścieżki/stany i wybór runtime; init/update A nie zmienia B. |
| AC-05 | Nowa wersja powstaje obok starej; aktywnego runtime nie przebudowuje ani nie przełącza aktualizacja. |
| AC-06 | Update oraz rollback zgodnych wersji zachowują stan i niezależne ustawienia; niezgodność jest jawnie odrzucona. |
| AC-07 | Doctor rozpoznaje podstawowe usterki, daje tekst/JSON i prawdziwy handshake, bez modeli lub mutacji featura. |
| AC-08 | Start zwykłym codex zweryfikowany w nowym projekcie albo udowodnione ograniczenie i sprawdzony pojedynczy wrapper. |
| AC-09 | Dokumentacja obejmuje instalację, nowy worktree, aktualizację, rollback, ograniczenia hosta i wspólny układ danych wave13. |

## Walidacja i sposób pracy

Testy bez modeli: tymczasowe repo/worktree, ścieżki ze spacjami, istniejące ustawienia,
powtórny init, konflikt pliku, przerwany zapis, build/wersja nieobecna, niezgodny host,
update A bez zmiany B, odmowa przy aktywnym użyciu i zgodny/niezgodny rollback.
Dla bezpieczeństwa stanu porównać snapshoty przed/po. Wykonać build, testy repo oraz
testy nowych zachowań; nie testować wyłącznie występowania tekstu w instrukcjach.
Kontrola przez prawdziwy klient bez promptu modelu może sprawdzić start i listę MCP.
Krótki smoke z Astrą i Claude’em przygotować dopiero po testach bezmodelowych,
z konkretnym zakresem/budżetem do zgody. Ten plan sam go nie uruchamia. Nie powtarzać
całego pilota wave10 ani nie przedstawiać atrapy jako dowodu rzeczywistej delegacji.

Jedna realizacja na osobnym branchu/worktree. W miarę możliwości wdrażać setup,
worktree i update w kolejnych użytecznych krokach, zamiast rozbudowanego frameworka.
Stosować wave11: konkretne blokery, wąskie korekty i krok wstecz przy nawrocie problemu.
Review oraz postęp w istniejącym rejestrze; nie wymagać osobnego odbioru każdego kroku.
Domknięcie: dowody AC, instrukcja użytkownika, raport i zaakceptowana integracja z CI.
Publikacja artefaktu/rejestru jest osobną konkretną akcją, nie skutkiem zapisania planu.

## Poza zakresem

Pełna diagnostyka/retencja/eksport (wave13), supervisor, automatyczne wzbudzanie Astry,
/goal, centralny serwer, współdzielenie jednego worktree przez wielu managerów,
rozszerzanie wsparcia nowych wersji hosta bez osobnego zakresu, Windows/macOS,
domknięcie wave6 REWORK i sztuczne wielogodzinne testy limitów.
