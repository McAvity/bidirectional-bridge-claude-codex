# F-W19 — rejestr review wykonania

## 2026-11-06 — W19-01, contracts: PASS

Reviewer: Codex, koordynator niezależny od wykonawcy Claude, nie od koordynacji.
Task bridge task_62fwmq4nrm; baza914c018dcd13813e701b3378e0efc813a12e99ec,
dostawa f8d092f1f83a44e8bda59c40ddf8dee6f4dfaf09 (kontrakt b8b053e).
Authority: decyzja03 i aktualne polecenie rozpoczęcia F-W19. Werdykt odblokowuje
W19-02; nie jest odbiorem produktu ani potwierdzeniem modelowych AC.

Receipt PASS: dokładna baza/head, ancestry, brak merge,20 ścieżek sprawdzonych
per commit, nowy ledger, nietknięte pliki koordynatora, czysty worktree.
Czytane: kontrakt, model/fixtures, probe_clients/w19lib i bazowy probe_lib,
dowód klientów, ledger; porównane z briefem/design i aktualną architekturą.
Powtórzono10 testów modelu kontraktu (73 przypadki), regenerację11 przykładów,
linki261/diff oraz rzeczywiste próby klientów bez modeli: findings identyczne,
profile osobiste bez zmian. Prywatny wynik review poza Git.

Klienty zachowują native session/thread przy resume i pokazują nowy tekst, lecz
stary tekst pozostaje w historii; lista skilli nie dowodzi aktywnego wydania.
Jawne ROOT/identity i potwierdzenie przez managera są wykonalnym kontraktem,
którego skuteczność modelowa wymaga W19-06. Przyjęte nazwy API/formaty są techniczną
decyzją koordynatora w ramach03; konsumenci implementują kontrakt, nie nowe AC.

### Jedna lista ustaleń i warunków implementacji

| ID | Priorytet / skutek i dowód | Status / rozliczenie |
| --- | --- | --- |
| R19-C01 | P2: tabela3.2 może sugerować dołączenie releases.json do bundle. Rejestr zawiera identity tego bundle, więc prowadziłoby to do samoodniesienia; dopisanie przyszłego wydania zmieniałoby stare bajty. | Warunek W19-02: release registry/source metadata pozostają poza hashowanym payloadem; tylko potrzebny kod helperów w wariantach. Doprecyzować kontrakt przy implementacji i sprawdzić niezależność całych drzew. Nie wymaga osobnej rundy kontraktu. |
| R19-C02 | P2: §6.4 wymaga ack dla run/resume/recovery, lecz tabela6.3 wymienia parametr tylko run. Bez spójnego recovery manager może nie potwierdzić zestawu. | Warunek W19-03/04: określić i przetestować wszystkie drogi resume z per-attempt identity oraz replay; bez cichego zastąpienia zestawu. |
| R19-C03 | P3: clients.json ma rzeczywiste UUID w nazwach plików sesji i zakodowany home w ścieżce Claude, mimo redakcji pól session_id. To syntetyczne próby, bez treści użytkownika/sekretów; nie blokuje implementacji. | Korekta w najbliższej partii W19-02: redagować także ścieżki, zachować prywatny dowód/hash i znaczenie findings; test z syntetycznymi ścieżkami. |
| R19-C04 | P2: restore wskazane również dla uszkodzonego bundle, a store słusznie zabrania nadpisania w miejscu (§3.4/§9). | Warunek W19-02: jawna procedura odtworzenia dokładnej identity z zachowaniem uszkodzonych dowodów; nie udawać naprawy przez zwykły no-op/copy. Test rzeczywistego filesystemu. |
| PILOT-AUTH-01/02 | Warunek dostępu: odizolowane profile obu klientów są wylogowane. | Otwarte przed W19-06; przygotować konkretne katalogi i komendy logowania, nie kopiować sekretnie osobistych auth. Nie blokuje W19-02…05. |
| PILOT-ENV-01 | Delegowany Claude nie dziedziczy CLAUDE_CONFIG_DIR bez wpisu env_vars. | W19-04/06: przekazać zmienną w izolowanej konfiguracji pilota i zweryfikować przed modelem. |

Te punkty pozostają widoczne aż do sprawdzenia implementacji; PASS kontraktu nie
zamienia ich w verified. Brak wykazanego konfliktu AC lub potrzeby nowej sesji.
Następne: W19-02, następnie W19-03…06 w istniejącej zgodzie.


## 2026-11-06 — W19-02: ukończony zakres, przejście do W19-03

Task task_pqfare78qr, baza90aa6ac, finalna dostawa aec3865; trzy próby w tej
samej sesji. Receipt: wszystkie ścieżki każdego commitu w zakresie, brak cudzych
zmian i zmian koordynatora, nowy ledger03; worktree czysty. Nie jest to końcowy
PASS produktu. R19-C01,C03,C04 rozliczone kodem/helperem i testami tej partii.
Niezależnie powtórzono35 testów test_workflow_bundle (PASS), odczytano mechanizmy
write/store/restore/lock/generatora, ledgery i zmianę kontraktu. Pełne review
integracji pozostaje W19-06; nie uruchamiamy ponownego review całego planu.

| ID | Priorytet / skutek i dowód | Status / rozliczenie |
| --- | --- | --- |
| R19-I01 | P1: helper begin zapisywał lock poza projektem przez docs/features symlink oraz feature-id ../../../outside. Dwa niezależne odtworzenia na38bcec8 potwierdziły rzeczywisty zapis. | FIXED3d74ba9, VERIFIED: te same scenariusze dają PATH_REDIRECTED/FEATURE_ID_INVALID bez zmiany zewnętrznego drzewa ani store;35 testów PASS, w tym6 nowych real-fs. Naprawione od razu ze względu na zapis poza zakresem. |
| R19-E01 | P2 środowiska:76 JS/2 Python testy instalatora/klienta nie przechodzą również na bazie hosta. Pełne logi bazowe i ledger01/02. | OPEN do zbiorczej walidacji W19-06. Nie oznaczono PASS ani pominięcia wymagań produktu. Bounded W19-02 wymaga focused/build/packages/docs; te kontrole przeszły. |
| R19-O01 | P3 procesu: adapter oznacza PARTIAL przy dowolnym failed verification, w tym znanym wyniku bazowym spoza kontraktu rundy; ponowne dołączenie wyniku spowodowało drugie BLOCKED mimo naprawy. | Rozliczono bez zmiany runtime/DB: próba2 wykonała wyłącznie uzgodnione bieżące kontrole, zachowując historyczne failures w ledgerach i risks. Następne rundy mają jawny zakres testów; pełna walidacja dopiero W19-06. Nie rozszerzać F-W19 o zmianę polityki deliverables. |

C01: registry/source metadata poza payloadem, test pełnych drzew drugiego komponentu.
C03: scrub również nazw sesji/zakodowanych ścieżek; dawna syntetyczna wersja zachowana
w historii, bez usuwania dowodów. C04: exact-identity restore przez kwarantannę,
nie nadpisanie immutable entry. C02 nadal wymagany w W19-03/04.
PILOT-AUTH: przygotowane izolowane profile i skrypt logowania poza Git; użytkownik
pyta o cel izolacji, wyjaśniono. Brak potwierdzonego logowania, pilot nieuruchomiony.
