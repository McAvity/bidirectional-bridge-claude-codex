# Wave11 — decyzje Astry i nadmiar koordynacji

> Aktualizacja: użytkownik zatwierdził Z1–Z5; instrukcje wdrożono lokalnie na
> branchu wave11. Integracja po wave10 musi zachować jego zmiany, zwłaszcza
> namespace wymiany. Szczegóły: [progress](wave11-progress.md). Poniżej zachowano
> historyczny dokument analizy/propozycji sprzed akceptacji.

Status: **ANALIZA GOTOWA DO REVIEW**. Zalecenia są propozycją; nie zostały przyjęte
ani wdrożone. Analiza dotyczy odebranego zakresu izolacji wave7 i integracji wave9,
nie całej mapy wydania wave7 ani technicznej poprawności bridge’a dzisiaj.

Najsilniejsze dowody nadmiaru dotyczą wyboru następnego kroku: pytania o zachowanie
już obowiązującego wymagania przed sprawdzeniem dostępnego rozwiązania, przedwczesnego
wniosku o konieczności launchera, kontynuowania korekt protokołu bez oceny uproszczenia
oraz ponownego sformalizowania zamknięcia R13-01. Nie potwierdzają tezy, że wszystkie
kolejne review były zbędne. Review08–11 znajdowały nadal istotne błędy, review13 wykryło
pominięte kryterium, a review14 rzeczywisty błąd wyboru worktree. Wave9 jest istotnym
kontrprzykładem: korekta historii i bramka publikacji nie stanowiły pętli poprawiania produktu.

## Źródła, wersje i metoda

Analiza wykonana samodzielnie w worktree `~/.herdr/worktrees/bridge/wave11`,
branch `wave11`, początkowo czystym. Plan obecny w HEAD
`b040ca1ab5e9a22525671373aa7cff99e4bd7dfe`. Bez delegacji, uruchamiania modeli,
Bridge MCP, recovery, zmian produktu, aktywnych skilli i runtime.

| Oznaczenie | Pełny commit |
| --- | --- |
| W7 — odebrana dostawa | `66e524f0e334b159ccd5fb3cd3606bf58e858a68` |
| W9 — dostawa integratora | `41755c545b38170b59a35e8a5a969bfc824740d8` |
| W9-M — integracja | `fb9c843ca3044a43bc5b21875568a4e7699c289f` |
| W9-S — aktualizacja statusu | `4adb51da1a10ecffd58b8091e3be7422bc355f9d` |
| W7-B — pierwotny brief i autoryzacja | `e5cc93a43c2c9c2d127725048a65faa2050b1696` |
| W7-R — instrukcje po naprawie timeoutu | `1ff15d0dc8ce2e624a3caf8d86c61dbce288ccf8` |
| W7-N — dowód natywnej tożsamości przed zmianą kierunku | `80962dd876d25b07fc831526fe424f015a00693b` |
| W7-C — zamknięty kontrakt | `da5fc87601fa0bcc39a0727fd2966070a6d97ad6` |
| W7-I — baza implementacji | `511d7de6fe388113e13558840ac747f1e7045834` |
| W7-P — pierwsza paczka do odbioru | `d5ea3ca53dc9f1adc1fc4e2d1c2d7c7d9f2ffcd4` |
| W7-F — poprawiona paczka do odbioru | `404bb4d69dc4a5e3945fc9b0252eed32542ae47b` |
| W9-B — plan integracji | `354c051371b7e5568c4ef34237eb8fa71bf11a76` |
| TR — źródło timeout/recovery | `956b1710a779ece310159025ccc8f00be4cad141` |

Ścieżki `reviews/`, `decisions/`, `execution/`, `evidence/` poniżej odnoszą się do
`docs/features/F-W7-manager-isolation/` w W7, chyba że podano wcześniejszy commit.
`Rnn` oznacza review, nie numer próby Claude’a. Pełne nazwy plików są w tabeli chronologii.
Odczyt historyczny: `git show <pełne-SHA>:<ścieżka>`. HANDOFF posłużył orientacji,
nie był samodzielnym dowodem wcześniejszej zgody lub wyniku. Przeczytano też plan wave7,
brief, decyzje 01–09, raporty i postęp wave9 oraz historię instrukcji.

Porównanie wersji skilli wykazało:

- `feature-review/SKILL.md` ma ten sam blob
  `e01d4df9033b1d206e125362c8a5f2688b9fd644` w W7-B, W7, W9-B, W9 i bazie wave11.
  Już wtedy nakazywał focused corrections i zabraniał spekulatywnych blokerów.
- `docs/features/README.md` w W7-B/W9-B miał blob
  `de202480aee909f47853483ab08df019f0d2e377`; zmiana w W7 dotyczyła namespace wymiany,
  nie reguły retry. Zasada dwóch rund bez postępu i autonomia zwykłych poprawek istniały wcześniej.
- `feature-execute/references/bridge-loop.md`: W7-B/W9-B
  `e57582b6b78275476b09ddcd40469e56b06a11dc`; po W7-R i w W9
  `1162a8c8c7b9da9ace07c377bb93d681efb825dd`. Zmieniono recovery terminalnego timeoutu,
  budżety i polling; nie zniesiono dokumentu review każdej rundy ani zakazu commitów
  koordynatora przy BLOCKED. W7 dodało później instrukcje namespace.
- `feature-execute`, `feature-decide` i role `using-bridge` oceniono w wersjach Git
  właściwych dla fazy. W7-R dostarczyło instrukcje recovery do worktree przed wznowieniem;
  nie przypisuję pierwszej rundzie możliwości, które pojawiły się dopiero wtedy.

Nie uruchamiano obecnej implementacji dla ponownego audytu dawnych bugów.
Reprodukcje i wyniki testów z review są **historycznymi dowodami**, nie testami wykonanymi
w wave11. Kontrprzykład w kontrakcie może uzasadniać REWORK projektu bez gotowego produktu.

## Materiał lokalny i rozdzielenie ról

SQLite czytano ze snapshotów wykonanych Python `sqlite3.Connection.backup` z połączeń
źródłowych `mode=ro`, bez kopiowania DB/WAL/SHM osobno. Odcięcie snapshotów:
2026-09-12 **13:40:14 UTC**. Oryginałów nie edytowano; nie wywoływano recovery.
Lokalny indeks pochodzenia, snapshoty i wybrane zapisy pozostają w `/tmp/wave11-private`,
poza Git, w katalogu z uprawnieniami 0700. Raport nie publikuje uchwytów, transkryptów
ani rzeczywistych odpowiedzi użytkownika. Odnośniki C0/C9/C12/C14/L7 to lokalne aliasy,
nie identyfikatory sesji ani nowe artefakty wymagane przez workflow.

| Alias / rola | Jak ustalono pochodzenie i zakres |
| --- | --- |
| C9 — manager wave7, Astra | Dokładne cwd/branch wave7, źródło `cli`, zlecenie izolacji, zgodne taski z feature DB i dokumentami. Inna sesja CLI z tego cwd zawierała jedynie próbę `pwd`; wykluczona. |
| L7 — wykonawca Claude | Dokładny uchwyt zapisany w `task_attempts` wave7 wskazał plik rozmowy. Prompty rund zawierają te same cele, findingi i bazy co dokumenty; nie wybierano najnowszego pliku. |
| C12 — dodatkowy reviewer Codex | `thread_spawn` z rodzicem C9 i rolą `identity_review`; początek po jawnym zleceniu dodatkowej oceny. Powracający reviewer, nie kilkanaście nowych niezależnych osób. |
| C14 — wykonawca integracji wave9, Astra | Dokładne cwd worktree `test`, źródło `cli`, pierwsze zlecenie wave9 i baza W9-B, dostawa W9. Nie miał zadania bridge dla tej integracji. |
| C0 — koordynator między sesjami, Astra | Sesja CLI głównego checkoutu, przekazane checkpointy i odpowiedzi dotyczące konkretnie wave7/wave9. Oceniono odpowiednie fragmenty, nie całą wcześniejszą historię projektów. Lokalna baza bridge koordynatora nie zawierała tasków ani feature’ów. |
| Guardian | Rozpoznany w metadanych jako `subagent/other/guardian`. Nie zaliczany do review kontraktu/produktu ani do pracy dodatkowego reviewera C12. |

Rozmowy C0/C9/C12/C14 odcięto 2026-09-12 **13:41:29 UTC**, L7 o **13:42:45 UTC**,
przez odczyt prefiksu pliku do zastanego rozmiaru. Nie zakładano zamknięcia sesji.
Pełne powiązania, rozmiary, hashe i dokładniejsze czasy są tylko w lokalnym indeksie.
Jawne komunikaty asystenta i użytkownika są czytelne; część argumentów narzędzi,
w tym komunikacji między agentami, jest zaszyfrowana. Nie próbowano jej odszyfrowywać.
To ogranicza ustalenie dokładnego zlecenia każdego follow-up, lecz nie uniemożliwia
oceny jawnych wyników review i pytań managera.

Snapshot W7 potwierdza dziewięć tasków rund, 14 prób i jeden wspólny uchwyt wykonawcy:
pierwszy task miał TIMEOUT → PARTIAL → COMPLETE, task implementacyjny
PARTIAL → PARTIAL → PARTIAL → COMPLETE, pozostałe po jednej próbie COMPLETE.
Stan featura: accepted. Nie oznacza to 14 review ani 14 błędów managera.

## Chronologia istotnych przekazań

Kolejność ustalono z wejść review, promptów L7, zdarzeń prób oraz komunikatów managerów.
Daty commitów nie wystarczają: R02/R03 zapisano razem, podobnie R08–R11 dopiero po DONE.
Każdy wiersz oddziela znalezienie problemu od konieczności kolejnej pełnej oceny.

| Faza i źródło | Cel → finding, dowód i ówczesne wymaganie | Poprawka → sprawdzenie → dalsza decyzja |
| --- | --- | --- |
| Kontrakt, `reviews/01-contracts.md` | Dostarczyć projekt izolacji. Po 15 minutach TIMEOUT, brak kontraktu/paczki. Ówczesny bridge-loop nie pozwalał wznowić terminalnego FAILED. | Diagnoza zachowanej sesji; osobna naprawa timeout/recovery. Brak PASS był właściwy. Propozycja zmiany wykonawcy nie była naprawą tego ograniczenia; użytkownik zachował role. |
| Kontrakt, `reviews/02-contracts.md`, `decisions/02.md` | Jedno jawnie dopuszczone recovery dało kontrakt. Eksporter odrzucał `docs/tasks/`; plan wybrał nieobsługiwaną ścieżkę. R02 wykrył także mutujące „odczyty”, cichą adopcję legacy, nieskuteczną poradę po przeniesieniu i brak dowodu dokładnego resume. | R02 początkowo zalecał zmianę eksportera albo warunku paczki. Decyzja03 wybrała mniejsze przeniesienie tych samych tasków do `work-items/`. Export/verify przeszły; zwykłe recovery dało DONE. Pytanie o następną próbę respektowało ograniczenie do jednego recovery. |
| Korekta kontraktu, `reviews/03-corrections.md` | R02-01/03/04/06 zamknięte w opisanym zakresie; native ID pozostał advisory, odczyty i rezerwacja DB nadal sprzeczne. AC-03 już wymagało dokładnego managera. | Manager zatrzymał na Q-02: zachować AC-03 i zbadać kanał czy dopuścić wariant ręczny. Badanie kanału powinno poprzedzić takie pytanie — sam review stwierdzał, że brak zweryfikowanego kanału nie dowodzi jego nieistnienia. |
| Badanie źródła, W7-N `evidence/03-native-manager-identity.md`, decyzje05/06 | Natywne `_meta.threadId` per-call i resume wykazane; brak ID przy spawn MCP. C12 wykrył ograniczenia próby i ryzyko czekania na hook podczas handshake. | Manager w podsumowaniu uznał hook/launcher za potrzebny. Koordynator zaproponował binding przy pierwszej mutacji; użytkownik zatwierdził granicę accidental-mixup i ten kierunek. Następne badanie potwierdziło wykonalność bez launchera. |
| Korekta kontraktu, `reviews/04-call-time-corrections.md` | r3 przyjmowało brak metadanych klasyfikacji, usuwało fencing instancji i external `--db`; reguła symlink i fizyczne „read-only” były błędne. Decyzja06 wymagała atomowej kontroli i braku przejęcia przez odczyt. | Przywrócono wymagane ścieżki; dopuszczono techniczne sidecary SQLite bez zapisów domenowych. To trafne uproszczenie gwarancji, nie obniżenie AC. R04 nadal REWORK, zwykła kolejna runda bez pytania. |
| Korekta kontraktu, `reviews/05-bootstrap-and-fencing.md` | r4: plik `wx` pozostaje po śmierci procesu; własny lock psuje test pustego katalogu; migracja może zapisać po takeover; ABA i reaktywacja fenced instancji. Odtworzono zachowanie locka. | Nowy mechanizm blokady, transakcyjna autoryzacja, CAS epoch+generation i historia; dokładna wersja adaptera. R05 odnotował postęp i wysłał następną korektę, bez zapisanej oceny prostszego protokołu. |
| Korekta kontraktu, `reviews/06-protocol-completeness.md` | r5: UNIQUE blokuje dozwolone I1→I2→I1 (wykonany SQL); resztki temp przeczą obiecanej odbudowie; brak dispatch naprawy; nieuzasadnione gwarancje wykrywania złych blokad FS. | Nieunikalny indeks, spójne tryby naprawy; lock bez zbędnej tabeli, lokalny poprawnie blokujący FS jako warunek. R06 nie dodaje doctor/instalatora. Następna korekta zamyka konkretne luki. |
| Zamknięcie kontraktu, `reviews/07-contract-final.md` | r6: SQL i zwolnienie locka po zabiciu procesu sprawdzone; R06 zamknięte. | PASS projektu, nie produktu. C12 potwierdził też zachowane metadane/fencing. Manager zakończył turę na następnym kroku W7-ID-02; użytkownik przekazał zlecenie kontynuacji. Ocena tej bramki niżej. |
| Implementacja, `reviews/08-implementation-partial.md` | Pierwszy kod: 362 testy PASS, ale async zapisuje przed właściwym guardem, konstruktor migruje za wcześnie, odczyt zamyka writer aktywnej rundy, publiczny Claude omija zakaz launch, brak części slot/legacy/crash. AC-02/04/05/07 rzeczywiście niespełnione. | REWORK potrzebny. C12 wniósł konkretne brakujące ścieżki. Operatorowy wrapper bez metadanych był osobnym problemem zakresu childa, nie argumentem za poluzowaniem ochrony produkcji. |
| Korekta implementacji, `reviews/09-recovery-guards.md` | Część R08 naprawiona. Pozostają preguard refresh, błędne replay, H/T naprawiające plik przed CAS (reprodukcja), niepełny slot, bootstrap i async lock. | Koordynator sam poprawił syntetyczny wrapper, 110 testów PASS; child kontynuował właściwy task. Kolejna korekta miała realny cel. Narzut oddzielnych dirty checkpointów wynikał z bridge-loop. |
| Korekta implementacji, `reviews/10-async-finalization.md` | R09-01…05 zamknięte w badanych ścieżkach. Pozostało async repair, adopcja przed odmową, kopia DB w tym samym worktree przy brakującym markerze (reprodukcja). Formalny BLOCKED wynikał też z formatu snapshotów dowodu. | Naprawa zachowania i poprawnego opisu dowodu; następne recovery, nie timeout. Możliwe było zachowanie ograniczonej historycznej obserwacji w ledgerze zamiast fabrykowania red/green. |
| Korekta implementacji, `reviews/11-replay-response.md` | DONE i 381 testów nie wykryły mutującego `result()` po replay/takeover ani pominiętego nonce w `reserving`. To nowe miejsca niespełnienia istniejącej reguły, nie ten sam zamknięty test. | Wąska nowa runda: pure view/derive i pełne porównanie nonce, testy publicznych wejść. Kontynuacja potrzebna; warto było wcześniej rozwiązać całą klasę odczytów odpowiedzi. |
| Zamknięcie implementacji, `reviews/12-implementation-final.md` | R11 zamknięte, 387 JS / 19 exchange / 110 pilot tooling, build i paczka zweryfikowane. | PASS i paczka W7-P do odbioru użytkownika. Pilot realnych dwóch par jawnie osobno; nie ma podstaw wymagać go jako brakującego dowodu tego lokalnego zakresu. |
| Review dostawy przez koordynatora, `reviews/13-coordinator-implementation.md` | C0 ponownie obejrzał implementację. AC-04 obejmowało paczki, a instrukcje nadal kierowały identyczne nazwy do wspólnego `~/tmp`. `ZipFile(...,'x')` chroni nadpisanie, ale drugi eksport koliduje. | R13-01 zasadny, choć nie jest utratą DB ani obejściem ownership. Użytkownik zlecił namespace i test dwóch worktree; decyzja08. Wynik dodatkowego review wartościowy, mimo słabego początkowego uzasadnienia jego szerokości. |
| Korekta wymiany, `reviews/14-exchange-corrections.md` | Namespace dostarczony, 25 testów. C12 odtworzył, że odziedziczone GIT_DIR/GIT_WORK_TREE mogą skierować `--repo B` do A; aktywne przykłady nadal płaskie. | R14-01/02 zasadnie wymagane. Osobno małe uwagi o direct unittest i ledgerze. Nowa runda bez ponownej zgody, kod/helper i przykłady poprawione. |
| Zamknięcie korekt, `reviews/15-exchange-final.md` | C12 sprawdził zmienione ścieżki, manager testy i paczkę. R13/R14 resolved, 29 exchange. | PASS, nowa paczka W7-F, pytanie o rzeczywisty odbiór. Zachowane wcześniejsze ustalenia manager identity, nie kolejny pełny audyt. |
| Ponowne potwierdzenie przez koordynatora, `reviews/16-coordinator-exchange.md` | C0 sprawdził poprawkę R13, 29 exchange i finalną paczkę. Nie znalazł nowego blokera; nie powtórzył JS/pilot. | Sprawdzenie własnego findingu zrozumiałe, osobny dokument i ponowny obieg rekomendacji zbędne. Wystarczył dopisek zamykający R13 z wersją i dowodem. C0 przyznał to po uwadze użytkownika. Decyzja09 i W7 zamknęły odbiór bez nowego review/testów. |

Review13 nie jest integracją kodu wave7 z wave9. To ocena odrębnej dostawy.
`execution/integration/` wave7 dokumentuje także paczki/checkpointy lokalnego wyniku;
nie należy liczyć każdego takiego pliku jako osobnego merge ani niezależnego audytu.

### Wave9 i poprzedzająca dostawa timeout/recovery

| Faza i źródło | Cel → finding / wymaganie | Poprawka → sprawdzenie → decyzja |
| --- | --- | --- |
| Review źródła przed wave9, TR `docs/tasks/timeout-recovery/DEPLOY-AND-RESUME.md`, C0 11.09 22:13 UTC | Kod recovery miał 379 testów PASS. Procedura nie dostarczała nowych instrukcji do worktree, myliła brak WAL/SHM ze stanem procesu i przewidywała niespójne kopiowanie SQLite. | Korekta procedury do TR; brak podstaw blokować kod na nowym kontrakcie izolacji. Kontrola procedury była potrzebna przed dotknięciem zachowanej sesji. To nie kolejna runda review implementacji wave9. |
| Autoryzacja W9-B `docs/plans/wave9.md` | Przygotować oczyszczoną integrację, zachować źródłową historię, bez modeli, merge/push/deploy przez wykonawcę. | C14 wykonał samodzielnie import i walidację, bez dodatkowego reviewera. |
| Kontrola importu, W9 `wave9-report.md`, C14 12.09 05:31–05:33 UTC | Tip był oczyszczony, lecz ścieżka lokalna pozostawała w pośrednich drzewach. Publikowany zestaw obejmuje historię; wymaganie prywatności było jawne od początku. | Oczyszczenie lokalnego importu wszystkich czterech commitów, zachowanie oryginałów i mapowania; ponowna kontrola zmienionej historii uzasadniona. Bez audytu całego upstream ani aktualizacji zależności. |
| Dostawa i review integracji, W9; C0 05:38–05:40 UTC | W9 dostarczono jako GOTOWE DO REVIEW. Koordynator sprawdził zgodność kodu ze sprawdzonym źródłem, mapowanie i dokumenty. | Pozytywne review integracji. Nie odesłał C14 do poprawiania recovery z powodu brakującego realnego pilota czy pięciu ostrzeżeń zależności. |
| Publikacja, C0 05:39–05:41 UTC | Próba merge/push odrzucona przez automatyczny przegląd uprawnień; komunikat managera wskazuje zgodę na konkretny zestaw i kontrolę danych. | Uzupełniono kontrolę, wyjaśniono zakres znanych danych i uzyskano zgodę publikacyjną. Pytanie nie dowodzi pętli review produktu. Nie znaleziono wtedy nowego konkretnego sekretu. |
| Integracja/status, W9-M, W9-S | Merge ma rodziców W9-B i W9; status odnotowuje publikację i CI. | W9-S raportuje sukces build i 379/19/110 w CI. W wave11 nie odpytywano GitHuba; potwierdzono historyczny zapis, nie dzisiejszy stan zdalny. Runtime wave7 pozostawał osobno. |

## Ocena decyzji i krótszy przebieg zachowujący wymagania

**O1 — dobór rozwiązania eksportu, R02-01.** Problem paczki był rzeczywisty; źródłem
był wybór ścieżek przez managera, nie samowola Claude’a. Zalecenie naprawy wspólnego
eksportera przed oceną dopasowania istniejącego planu było nieproporcjonalne.
Już wtedy istniały parser manifestu i fallback Markdown w feature-plan. Lepszy przebieg:
sprawdzić wymagany format tasków przed rundą, a po błędzie przenieść te same taski
z odsyłaczami i wykonać export/verify. Decyzja03 rzeczywiście zrobiła to bez zmiany
produktu. Nie twierdzę, że samo zatrzymanie na wykorzystanym jednym recovery było zbędne:
to było konkretne ograniczenie z decyzji02.

**O2 — przedwczesne Q-02, R03-01.** Finding słusznie blokował uznanie ręcznego tokenu
za dowód AC-03. Nie uzasadniał jeszcze wyboru użytkownika „zachować AC czy osłabić”.
R03 sam przyznawał brak sprawdzenia kanału, a W7-B autoryzował realizację wymagania.
C9, 11.09 23:21 UTC, zakończył pytaniem i zatrzymał także zwykłe korekty.
Lepszy przebieg: lokalnie ustalić dostępne metadane i ich ograniczenia, kontynuować
niezależne poprawki R03-02/03, a pytanie zadać dopiero przy wykazanej niemożliwości
lub rzeczywistym wyborze gwarancji. Późniejszego wyniku `_meta` nie zakładamy jako
wiedzy R03; zarzut dotyczy zaniechania dostępnego badania przed eskalacją.

**O3 — launcher jako rzekoma konieczność, W7-N i C9 12.09 05:32 UTC.** Badanie i C12
wniosły realną wartość: źródło host ID, resume, ograniczenia testu, deadlock hooka.
Jednak brak ID przy spawn nie dowodzi potrzeby dodatkowego launchera dla celu „zwykły
Codex i dokładny manager”. Wtedy znano już per-call ID. Lepszy przebieg: przed
rozbudowaniem integracji rozdzielić handshake od pierwszej mutacji, sprawdzić
klasyfikację guardiana i atomowe przypisanie. Jeśli preferencja startup oznaczałaby
wiążący warunek czasowy, przedstawić tę konkretną zmianę użytkownikowi po zbadaniu
wariantu. Decyzja05 preferowała startup, więc manager nie miał prawa samowolnie
usunąć warunku; miał podstawę zaproponować prostszy wariant. Decyzja06 i R04/R07
pokazują, że nie trzeba było dodawać hooka. To potwierdzony moment uproszczenia,
nie zgoda na przyjmowanie dowolnego pierwszego callera.

**O4 — postęp bez oceny rosnącej złożoności, R03→R04→R05→R06.** Ta sama klasa
rezerwacji/odbudowy worktree i DB wracała w projekcie, choć każdy przykład ujawniał
inną lukę. Nie należy zamykać stale-lock, ABA czy migracji przed guardem jako kosmetyki.
Problem decyzji managera: powtarzane „postęp, nie impas” wystarczało do następnej rundy.
Najpóźniej R05, trzeci kolejny przegląd tej klasy po R03/R04, powinien uruchomić
krótkie porównanie podejść. Dostępny wtedy prostszy kierunek: jeden protokół serializacji
z prymitywem zwalnianym po śmierci procesu; C jako autorytatywny stan; odczyty bez napraw;
jedna jawna ścieżka naprawy po sprawdzeniu uprawnień. Niejednoznaczne pozostałości mogą
być fail-closed z instrukcją operatora zamiast obietnicy automatycznej odbudowy każdego
stanu — decyzja06 dopuszczała taki kierunek. Nie wolno jednak usunąć external `--db`,
kopii/symlink checks ani obiecanej poprawnej obsługi jednoznacznych stanów bez oceny
kontraktu. To kandydat do rozważenia, nie dowód gotowego równoważnego projektu.
R06 już pokazuje mniejsze lokalne uproszczenia: zbędny UNIQUE i tabela locka znikają,
niewykrywalna gwarancja FS staje się jawnym warunkiem środowiska.

**O5 — powracające skutki uboczne odczytu, R08–R11.** R08-03, R09-01/02,
R10-02 i R11-01 nie są ponownym wykrywaniem identycznej zamkniętej linii kodu.
Są ścieżkami jednej klasy problemu. Przy R10 warto było ułożyć jeden krótki podział:
czysta kontrola/replay/odpowiedź; atomowa rezerwacja z guardem; zaufane zakończenie
workera. Następnie sprawdzić wszystkie wejścia korzystające z mutującego get/refresh,
zamiast korygować kolejny hook. R11 podaje konkretne uproszczenie `result` → pure view.
Lepszy przebieg nadal zatrzymałby zapis po takeover i błędną adopcję; nie wolno wydać
PASS tylko dlatego, że poprzedni replay był naprawiony. Dopiero dalsze użycie pokaże,
czy taki krok rzeczywiście ogranicza nawroty — nie szacuję liczby zaoszczędzonych rund.

**O6 — powtarzanie zamknięcia i dodatkowy reviewer.** C12 w R04–R06 oraz R08–R11
wnosił konkretne ustalenia; w R14 odtworzył wybór złego worktree. Nie rekomenduję
usunięcia tych kontroli. W R07 przypominał zamknięte już metadane i wersję adaptera;
krótki re-check ich zachowania obok zmienionego SQL jest rozsądny, pełny nowy audyt
nie byłby potrzebny. Nie ma dowodu, że taki pełny audyt wtedy wykonano.
Najpewniejsze powtórzenie to R15→R16: ten sam R13-01 zamknięty przez C12 i managera,
a potem kolejny dokument z potwierdzeniem przez C0 bez nowego findingu. R16 był
już wąski i świadomie nie powtarzał JS/pilot; nie nazywam go pełnym audytem.
Lepszy przebieg: autor R13 sprawdza wskazany diff i dowód, dopisuje datowane zamknięcie
w istniejącym rejestrze, jedna rekomendacja do odbioru. C0 sam to uznał 12.09
10:59 UTC. R13 zachowujemy: luka paczek była wprost w AC-04. Natomiast uzasadnienie
C0 przed R13, że wcześniejszy PASS nie dowodzi dwóch realnych par, mieszało osobną
bramkę wydania z lokalnym zakresem; lepszym celem dodatkowego review było domknięcie
pokrycia AC-04, nie kolejna ogólna kontrola „dla pewności”.

**O7 — nie każda drobna uwaga i nie każda ostrożność były blockerem.** R02-06
(pre-amend hash ledgera) poprawnie pozostało advisory, bo Git pozwalał ustalić zakres.
R04-05 słusznie rozdzieliło techniczny WAL/SHM od mutacji domeny. R05-05 ograniczało
wersję hosta do dowodu 0.154.0 przy gwarancji zależnej od jego metadanych; brak podstaw
nazwać to spekulatywnym blockerem. R06 odrzuciło obietnicę wykrywania niesprawnych
blokad FS bez dodawania diagnostyki. Małe uwagi R14 (direct unittest i sformułowanie
ledgera) należało jawnie oznaczyć jako nieblokujące; review nie dowodzi jednak, że
samodzielnie spowodowały następną rundę, bo R14-01/02 były materialne.

**O8 — przekazania użytkownikowi i autoryzacja.** W7-B już zlecało plan, wykonanie,
review i zwykłe poprawki. Jednak po Q-02 decyzja06 i bezpośredni prompt użytkownika
zawęziły bieżący krok do badania/korekt kontraktu, z zakazem produktu w tej rundzie.
Zakończenie po R07 i nową decyzję07 oceniam jako możliwy narzut granicy taska, lecz
nie jako jednoznaczne naruszenie zgody: dokumenty i ostatni prompt nie rozstrzygają
bezspornie, czy wcześniejsza szeroka zgoda miała uruchomić produkt natychmiast.
Lepsze kontrakty rund wskazują: „zakres tej rundy” oddzielnie od „autoryzacja pozostałego
featura”; techniczny PASS automatycznie zwalnia zależność tylko w zachowanej zgodzie.
Q-03/Q-04 były pytaniami o faktyczny odbiór i pozostają potrzebne. Powtarzany przez
C0/C9 obieg tekstu do wklejenia można skrócić do jednego konkretnego wskazania decyzji
oraz źródła, bez proszenia użytkownika o zatwierdzanie jej technicznego zapisu.
Nie przypisuję czasu między oknami pracy managera ani nie postuluję automatycznego
wysyłania wiadomości w imieniu człowieka.

**O9 — wave9: kontrola publikacji, nie nadmierny audyt.** Historyczna ścieżka we
wcześniejszym drzewie była istotna dla jawnego wymagania publikacji oczyszczonej historii;
jej usunięcie nie było „uszczelnianiem na zapas”. Nie wykazano serii zbędnych review
C14. Tarcie C0 polegało na próbie merge/push przed zakończeniem kontroli akceptowanej
przez system uprawnień, a potem wyjaśnianiu ogólnego hasła „dane wrażliwe”, choć znane
wpisy były już oczyszczone. Lepszy przebieg: najpierw zestawić dowód importu i zakres
publikacji, potem wykorzystać istniejącą zgodę lub uzyskać brakującą zgodę na konkretny
wynik. Nie rozpoczynać ponownego audytu prywatności całego projektu. Odmowy zewnętrznego
reviewera uprawnień nie można usunąć instrukcją skilla. Dostępne jawne wypowiedzi
managera potwierdzają odmowę, ale dokładne argumenty i pełna ocena guardiana pozostają
nieodczytane; nie rozstrzygam, czy system prawidłowo ocenił całą wcześniejszą autoryzację.

## Skąd wynikało tarcie

| Źródło | Obserwacja i odpowiedzialność | Co zmiana workflow może zrobić |
| --- | --- | --- |
| Skille | Wspólne instrukcje już zabraniały dodatkowych bramek i zalecały focused corrections, lecz jednocześnie wymagały osobnej sesji oraz następnego `reviews/NN` każdej rundy. Retry patrzył na brak postępu, nie rozrost złożoności. | Usunąć konflikt: jeden niezależny od wykonawcy review, kolejne wpisy w rejestrze i krok wstecz także przy postępie. |
| Decyzja managera | O1/O2/O3: niedopasowanie tasków, pytanie przed badaniem, przywiązanie do startup binding. O4/O5: lokalny postęp bez porównania prostszego podejścia. O6: ponowny obieg zamknięcia. | Wymagać związku blokera z celem, sprawdzić dostępny prostszy wariant i konkretną wartość dodatkowego reviewera. |
| Autoryzacja użytkownika | Jedno recovery, potem kontrakt-only, budżety, odbiór i zgoda publikacyjna. | Przenosić udzieloną zgodę wiernie. Uproszczenie procesu nie rozszerza zakresu ani nie uznaje milczenia za akceptację. |
| Format i narzędzia | R02: eksport wymaga `work-items/`; R10: walidator wymaga identyfikatorów snapshotów; opis rundy przekroczył 2000 znaków (C9 05:48 UTC). | Preflight zgodności wejścia; krótkie odsyłacze do ustaleń; nie mylić formatu dowodu z błędem produktu ani fałszować dowodu. |
| Skille + współdzielony Git | Zakaz commitów koordynatora przy BLOCKED wymuszał dirty snapshoty i późniejsze zbiorcze checkpointy R02/03, R08–11. | Rozpoznajemy narzut; proponowany mały diff nie zmienia tej reguły, bo wymaga osobnego sprawdzenia pochodzenia zakresów i runtime. Nie tworzymy teraz audytu bridge’a. |
| Zewnętrzne środowisko/uprawnienia | Bubblewrap, odmowa publikacji; guardian ocenia akcję, C12 ocenia produkt. | Użyć standardowej eskalacji i wyjaśnić faktyczną odmowę. Nie mnożyć review produktu w odpowiedzi na błąd środowiska. |

## Hipoteza trzeciego review i niewielki zestaw zaleceń

Hipoteza jest **uzasadniona jako sygnał refleksji**, nie potwierdzona jako optymalna
liczba. R03→R05 (rezerwacja/odbudowa) i R08→R10 (guard/async/replay) wskazują miejsce,
gdzie wciąż realne findingi powinny skłonić do spojrzenia na całą klasę problemu.
Liczyć należy nawrót problemu w fazie, przez powiązane ID, nie numery plików.
R07 kontrakt PASS → R08 implementacja nie jest takim powtórzeniem. R13→R15 jest
łańcuchem korekty z nowym materialnym błędem; przy trzecim sprawdzeniu można krótko
uznać obrane podejście za wystarczająco proste i zamknąć finding. Nowy defekt nigdy
nie znika z powodu licznika. Krok wstecz może nastąpić wcześniej, jeśli to oczywiste.

| Zalecenie | Obserwacja → mechanizm | Ryzyko i zachowana kontrola |
| --- | --- | --- |
| Z1. Trzy dyspozycje ustaleń | O1/O7/O9 → blocker odbioru, uwaga nieblokująca, osobne zadanie; jawny cel i dowód. | Nie wolno przenieść niespełnionego AC do backlogu bez zmiany zakresu przez uprawnioną osobę. |
| Z2. Re-check otwartych ID | O5/O6 → jeden rejestr na fazę, datowane dopiski wersji, testów i zamknięć; bez kopiowania wcześniejszego review. | Nowy defekt i konkretna regresja otwierają własne ustalenie; zachować wcześniejsze wyniki i provenance. |
| Z3. Reviewer dla konkretnej wartości | O6 i pozytywne C12/R14 → wskazać ryzyko, lukę kompetencji albo potrzebną niezależność przed dodatkowym zleceniem. | Manager niezależny od Claude’a może recenzować, ale nie nazywa własnej implementacji niezależnie ocenioną. Jawne wymaganie zewnętrznego review pozostaje. |
| Z4. Krok wstecz przy nawrocie | O2–O5 → przy trzecim sprawdzeniu problemu krótko ocenić wagę, dowód i prostszy wariant; działać w dotychczasowym zakresie. | Bez limitu napraw i bez obowiązkowego dokumentu/pytania; materialna zmiana AC wymaga osobnej decyzji. |
| Z5. Jedna ścieżka autoryzacji i odbioru | O8/O9 → najpierw odczytać istniejącą zgodę i zebrać dostępny dowód; pytanie dopiero o nierozstrzygnięty wybór. | Techniczny PASS, zgoda publikacyjna i odbiór użytkownika pozostają odrębne. Zewnętrzna odmowa nie jest uchylana skillem. |

Dokładna propozycja: [wave11-workflow-proposal.patch](wave11-workflow-proposal.patch),
objaśnienia i scenariusze: [wave11-workflow-proposal.md](wave11-workflow-proposal.md).
Diff jest na bazę wave11, nie na zmienne pliki wave7/wave10. Przed ewentualnym wdrożeniem
trzeba rozliczyć późniejsze zmiany instrukcji, zwłaszcza namespace; nie stosować go w ciemno.

## Ograniczenia i zakończenie

Nie da się z tego materiału uczciwie wyliczyć czasu lub tokenów zaoszczędzonych przez
zalecenia. Timestampy prób mierzą przedziały wykonawcy, odstępy obejmują review, polling,
pracę człowieka i inne aktywności. C9 zgłoszono zbyt częsty polling i później używano
pięciu minut; to realna korekta koordynacji, nie dowód straty całego czasu oczekiwania.
Nie sumowano użycia długiej sesji C0 ani danych innych fal jako kosztu wave7/wave9.

Brakujące dowody do mocniejszych wniosków:

- pełne czytelne specyfikacje wszystkich follow-up C12 i ich powiązanie z konkretnym
  przyrostem wyników — potrzebne do oceny, które zlecenia były redundantne; jawne
  wyniki wystarczają do potwierdzenia wartości kilku z nich;
- dokładne odrzucone polecenie i uzasadnienie auto-review wraz z obowiązującą wtedy
  pełną autoryzacją publikacji — potrzebne do oceny poprawności odmowy, nie do jej
  przypisania do osobnej kategorii;
- jednoznaczne rozstrzygnięcie, czy późniejszy kontrakt-only tylko ograniczał rundę,
  czy czasowo zawieszał wcześniejszą zgodę W7-ID-02 — potrzebne do kategorycznej oceny
  zatrzymania po R07;
- alternatywny projekt wraz z testami równoważności — potrzebny, by twierdzić, że
  uproszczony bootstrap rzeczywiście zastąpiłby wszystkie korekty. Teraz wskazano
  zasadny moment decyzji, nie udowodniono gotowej implementacji;
- obserwacja następnego rzeczywistego featura po osobno zaakceptowanych zmianach —
  potrzebna do oceny zachowania agentów, której analiza dokumentów nie zastąpi.

Błąd środowiska wave11: `bwrap: loopback: Failed RTM_NEWADDR: Operation not permitted`.
Pracę kontynuowano przez standardową eskalację, bez naprawy sandboxa/MCP/runtime.
Nie zmieniano worktree wave7/wave10, baz źródłowych ani ich dokumentów.
Walidacja wave11 obejmuje dokumenty, referencje, diff propozycji i scenariusze rozumowania;
nie jest ponownym PASS produktu, testem modeli ani odbiorem zaleceń przez użytkownika.

Po osobnej akceptacji zaleceń wystarczy w kolejnym autoryzowanym feature obserwować:
czy każdy blocker ma AC/dowód, czy re-check obejmuje otwarte ID, czy nawrót uruchamia
rozważenie uproszczenia i czy końcowy odbiór nadal pochodzi od użytkownika. Zapisać wynik
w istniejącym progress; nie tworzyć obowiązkowej serii nowych review ani uzależniać
zamknięcia tej analizy od eksperymentu bez końca.
