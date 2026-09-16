# Review W13-02/03 — eksport i walidacja całości

REWORK. Paczka jest integralna, ale minimalny eksport ujawnia treść, przekracza wybrany
zakres i podąża za symlinkami. Wykonuje też kod wskazany przez diagnozowany projekt.
Potrzebne zwykłe poprawki w autoryzowanym zakresie. Nie potrzeba decyzji użytkownika.
Rekomendacja: jeden spójny zestaw granic odczytu/zapisu oraz ścisłych projekcji,
minimalny zestaw poprawnie obsługiwanych selektorów, następnie wąskie re-review.

## Zakres i dowody

2026-09-16. Codex koordynuje i recenzuje, nie implementował kodu Claude’a.
Task task_4avpacpvbp DONE; brak aktywnej próby. Baza 536f7743b0124cba26e5821e0949ca5643fbd6f2,
HEAD cf2365c3d473be2c7119d0682b85b70e155ec661, czysty worktree.
F-W13-round-2.zip SHA-256 c7dc7596d34e6b776d086e496459f374b6c3becd8f969e4ccca478fd1d28f60b;
verify z oczekiwanym feature/purpose/base/head PASS; 18 zmian, bez driftu dokumentów.
Wszystkie ścieżki zmian mieszczą się w kontrakcie. Przejrzano collect/project/zip,
CLI/doctor, testy i ledgery. Niezależne 22 testy diagnose/setup PASS. Wykonawca raportuje
build, 469 JS, 31 Python exchange/ZIP, 140 pilot i docs PASS. Poniższe reprodukcje
wykonano na finalnym HEAD, w syntetycznych katalogach tymczasowych, bez modeli.

## R2-01 — prywatna treść przedostaje się do paczki minimalnej

Blocker AC-06 / §4. projectLogRecord kopiuje dowolny scalar details o poprawnej nazwie
klucza; nie ma listy dozwolonych kluczy. projectEvent zwraca error.message z JSON.parse,
który zawiera fragment wejścia. collectEvidence, gaps i część versions/feature również
są serializowane poza wspólną ścisłą projekcją. Test własny projectLogRecord z
syntetycznymi details.prompt/answer zachował obie treści; projectEvent z błędnym JSON
zachował fragment wejścia. Hash tego modułu przed reprodukcją:
07cf7d24c23c2ba1f6958f85fa6ed69c6deb944dc92628f12dd944b255f3ab88.
Pełny runDiagnose z syntetycznym logiem zachował REVIEW_PRIVATE_ANSWER_731 w ZIP-ie.
Naprawa: jawne dozwolone klucze i typy/etykiety dla każdej części wyniku; błędy jako
stałe kody bez fragmentów wejścia. Wszystkie projekcje, manifest/gaps/timeline/evidence
metadata mają przechodzić tę samą granicę prywatności i spójne aliasy; nie opierać
się wyłącznie na regexach znanych tokenów. Testy z dowolnymi sekretami w log.details,
niepoprawnym JSON-ie, evidence metadata i uszkodzonych plikach setup; domyślnie
zero sentineli i prywatnych ścieżek w całej paczce. Surowe rozszerzenia pozostają jawne.

## R2-02 — niepełne granice filesystemu i wyjścia

Blocker AC-07 / §3–4. Sprawdzane jest tylko .bridge i typ pojedynczego wpisu logu.
collectLogs podąża za symlinkiem katalogu logs; collectEvidence za evidence i jego
katalogiem taska; default bridge.db może być symlinkiem. mkdir/rename wyjścia podążają
za symlinkami katalogów przestrzeni wymiany. Niezależna pełna reprodukcja:
- logs -> outside-logs: rekord spoza zakresu odczytany i zapakowany;
- evidence -> outside-evidence: metadane obydwu plików spoza zakresu zapakowane;
- packages -> outside-output: sentinel.zip powstał w zewnętrznym katalogu.
Istniejący target jest sprawdzany przed renameSync, ale rename nadpisze target
utworzony pomiędzy sprawdzeniem a publikacją. --name nie ma walidacji traversal,
--out omija obiecany namespace. Eksporter powiela resolver exchangeNamespace zamiast
używać istniejącego; zachować istniejącą tożsamość i kanoniczny resolver.
Naprawa: wspólne bezpieczne odczyty z kontrolą komponentów i regularnego pliku,
bez podążania za linkami; poprawnie obsłużyć jawne --db zewnętrzne (wraz z miejscem
jego evidence). Bezpieczne prywatne staging i atomowa publikacja bez nadpisania.
Ograniczyć output do przewidzianego namespace. Można usunąć niepotrzebne opcjonalne
obejścia --out/--name, jeśli upraszcza to zgodny z planem interfejs; nie dodawać trybów.
Testy katalogowych symlinków, symlinka DB, nazw traversal i kolizji w momencie
publikacji; pliki zewnętrzne i istniejące paczki bez zmian.

## R2-03 — wybrany zakres nie obejmuje wszystkich źródeł jednakowo

Blocker AC-04/06 / §3. --attempt filtruje tylko task_attempts; telemetry/events/logs/
evidence nie są tak filtrowane. Niezależny runDiagnose task+attempt0:
attempts=[0], telemetry=[0,1], evidence=[0,1], log próby1 w wyniku.
Nieistniejący feature/task z --since tworzy warunek czasu bez ograniczenia tasków,
co może wyeksportować inne incydenty. inScope bierze wszystkie rekordy bez taska
z całej historii; dla window akceptuje też nieprawidłowy czas. Limit50 tasków okna
nie jest jawnie zgłoszony. Naprawa: jeden wyliczony zakres dla wszystkich źródeł,
nie poszerzać go przy braku identyfikatora/uszkodzeniu. Procesowy kontekst ma mieć
uzasadnione powiązanie/cutoff, nie być całą historią. Albo poprawić semantykę
opcjonalnych selektorów, albo uprościć CLI do minimalnego zestawu przewidzianego
w planie (plan nie wymaga wszystkich dodanych flag). Testy dwóch prób i obcego
incydentu, nieznanego ID, granic czasu i niepoprawnych kombinacji argumentów.

## R2-04 — diagnose wykonuje kod z diagnozowanej selekcji runtime

Blocker kontraktu rundy (safe subset bez uruchamiania kodu projektu), §4.
runDiagnose wybiera selectionRuntime przed kodem swojego CLI, a resolveIdentity
importuje jego shared/control-plane/dist/index.js. runDoctor safeSubset ma tę samą
kolejność. Weryfikacja manifestu to tylko kształt, a verifyRuntime następuje później.
Niezależna reprodukcja z syntetycznym manifestem i modułem tworzącym znacznik:
Samo diagnose bez scope uruchomiło moduł (executed=true).
Naprawa: kolektor i safeSubset używają zaufanego kodu własnego CLI/buildu; wskazany
runtime jest danymi do oglądania. Bez importów/uruchamiania ścieżek z diagnozowanego
stanu. Test ze złośliwym syntetycznym modułem musi pozostawić znacznik nieutworzony.
Nie przebudowywać ani zmieniać aktywnego przypiętego runtime.

## R2-05 — granice odczytu i braki są raportowane nieprecyzyjnie

Blocker AC-05/07/08 / §3. collectLogs czyta cały plik readFileSync i dopiero potem
ucina końcówkę; nie odczytuje zadeklarowanego ograniczonego prefiksu. Manifest nie
zawiera per-file offsetów/rozmiarów odczytu, tylko liczbę plików i sumę bytes_read;
read_at to początek całego eksportu, przed backupem/doctor. records.slice(0,5000)
i SQL LIMIT5000 milcząco pomijają resztę, bez markerów truncation. Logi mogą zostać
obcięte przez retencję/rotację w trakcie odczytu bez rozpoznania tej sytuacji.
Naprawa: ograniczony odczyt deskryptora, rzeczywiste cutoffs i stat/inode/prefix
metadata per plik; wykryć/uczciwie oznaczyć zmiany, niepoprawne końce i limity.
Test >5000 rekordów i rotacji/usunięcia/podmiany podczas eksportu; braki widoczne
w pakiecie. Nie obiecywać wspólnej atomowości DB/logów ani chronologii między zegarami.

## R2-06 — macierz oznacza niewykonane scenariusze jako PASS

Blocker dowodowy AC-07 i wymaganej walidacji planu. W13-03 ledger nazywa odmowę
istniejącej paczki i brak uprawnień testem „interrupted export”, a EOF zastępuje
nagłe przerwanie. Nie ma rzeczywistego przerwania eksportu ani deterministycznej
rotacji podczas odczytu; 64KiB ustawione w teście nie dowodzi, że rotacja zaszła.
ENOSPC jest jawnie niewykonany, ale plan wymaga symulacji pełnego dysku.
Naprawa: prawdziwe/deterministycznie wymuszone scenariusze przerwania podczas backupu
lub zapisu paczki, ENOSPC/krótki zapis, rotacja podczas odczytu i hard-stop workera.
Sprawdzić brak naruszenia źródła/cudzych plików, politykę resztek prywatnego stagingu,
brak pozornie kompletnego wyniku i użyteczną lukę. Nie wymaga to realnych modeli.
Zachować poprzednie ledgery, skorygować twierdzenia w nowym ledgerze/macierzach.

## Pokrycie i dalszy krok

AC-01–03: zachowują review W13-01, brak wykazanej regresji. AC-04/05/06/07/08:
unmet lub częściowo unverified zgodnie z findingami powyżej; PASS wykonawcy nie
jest odbiorem. AC-09: dokumenty istnieją i linki przechodzą, ale opisy bezpieczeństwa
wymagają zgodności z korektą. Zlecić kolejną rundę tej samej sesji Claude’a na
R2-01–06, w granicach decyzji01. Pełne testy po zmianach, następnie wąskie re-review.
