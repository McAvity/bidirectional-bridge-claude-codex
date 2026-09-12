# Review korekt r2 — REWORK i decyzja AC-03

Task task_<historical-10> osiągnął DONE w próbie 2, w tej samej sesji Claude’a. Pakiet jest poprawny i blokada eksportu została usunięta. Kontrakt nadal nie jest gotowy do implementacji: pozostają opisane niżej sprzeczności i istotna decyzja Q-02 o gwarancji natywnej tożsamości managera. Nie przyjęto featura. Zatrzymanie wynika z jawnej granicy „istotna decyzja”, nie z impasu — korekty zrobiły postęp.

## Wejścia i niezależne kontrole

Reviewer: Codex koordynator, niezależny od wykonawcy Claude, nie od koordynacji. Przeczytano pełne zmienione części kontraktu, ledger 02, review 02, brief i decyzję 03 oraz odpowiednie źródła (FeatureWorkflow, lifecycle, ControlPlane, LeaseManager, SqliteStateStore). Scope wykonawcy w f978b69bc4cb70189d67c13d712e800f23ecf16a..08d01c7353ed0673c4ef9c07247da42d2c02b1b7: tylko contracts/identity.md i execution/W7-ID-01/02.md. Ledger 01 pozostał nietknięty.

Oryginalna paczka: ~/tmp/F-W7-manager-isolation-round-1.zip, purpose contract-review, base e5cc93a43c2c9c2d127725048a65faa2050b1696, head 08d01c7353ed0673c4ef9c07247da42d2c02b1b7. SHA-256 d40cb541c544ec8a469a07d81dba9eaba6ab9f89d762f103103fda83098bccb9. Niezależne verify z expect-feature/purpose/base/head: exit 0, integrity ok, range_matches_repository true, documents changed/missing [].

Snapshot koordynatora sprawdzony przed zapisami tego review: 11 plików + sam plik snapshotu identyczne (snapshot SHA-256 7eb443cbb577d0b4b4f13c07fd9ae41d9110d1e3c8fd7e675e353faffd575971). Zakres paczki obejmuje historyczne commity koordynatora i prawdziwy dirty document snapshot; zakres rzeczywistej korekty wykonawcy podano wyżej. git diff --check f978b69..08d01c7: exit 0. Nie uruchamiano build/test produktu ani scenariuszy kontraktu — implementacji nadal brak. Te kontrole dowodzą pochodzenia i integralności, nie poprawności runtime.

## Rozliczenie R02

| Finding | Stan | Uzasadnienie |
| --- | --- | --- |
| R02-01 | resolved | Te same taski kanonicznie w work-items/, docs/tasks/ to odsyłacze. Eksporter bez zmian. Export i verify przechodzą. |
| R02-02 | progress | Boot reaping zastąpiono planem pure inspect, obcy recover/feature_get nie ma zapisywać; jednak klasyfikacja i transakcyjność owner-only zapisów są nadal sprzeczne (R03-02). |
| R02-03 | resolved na poziomie kontraktu | Legacy z historią domyślnie odrzucane bez mutacji; adopcja jawna, rejestrowana. Usunięto fałszywe uzasadnienie ochroną przez cwd lookup Claude’a. Implementacja i testy nadal wymagane. |
| R02-04 | resolved dla podstawowego sposobu | Powrót do zapisanej oryginalnej ścieżki przywraca zgodność rekordów; usunięcie samego markera jawnie nieskuteczne. Wariant archive ma dodatkowe ograniczenie opisane niżej. |
| R02-05 | progress / decyzja | Opisano źródło, custody i missing-data stop, ale proponowany model świadomie nie weryfikuje natywnej sesji i uzależnia restart od użytkownika. Q-02 nie została rozstrzygnięta (R03-01). |
| R02-06 | resolved | Nowy ledger wyjaśnia pre-amend hash i poprawny f978b69, starego ledgera nie przepisano. |
| Wyścig dwóch worktree / nowy wspólny DB | progress | Dodano per-DB sidecar przed tworzeniem SQLite; pozostał inny wyścig oraz niespójne odtwarzanie markerów (R03-03). |

## Istotna decyzja — R03-01 / Q-02 (wymagane)

Kontrakt §9.2–9.3 i §16: native_session_id nadal opcjonalne/advisory; użytkownik ma sam uzyskać ID z klienta i przechowywać token, a bridge nie potwierdza, że podłączony proces jest natywną sesją X. §9.3 nazywa silniejsze sprawdzanie „new requirement”; brief AC-03 już jednak wymaga identyfikowania dokładnie przypisanego managera przy wznowieniu. Nie wolno samodzielnie uznać tego za nowy wymóg i obniżyć odbioru.

Brak zweryfikowanego kanału w tej analizie nie dowodzi, że taki kanał nie istnieje. Nie zweryfikowano interfejsu runtime dostarczającego bezpieczne powiązanie; sam odczyt symbolu w binarce nie rozstrzyga sprawy. Maszynowy plik tokenu (wariant b wykonawcy) także sam w sobie nie potwierdza natywnej tożsamości, więc nie jest równoważnym sposobem spełnienia AC-03.

Decyzja użytkownika: zachować pierwotną gwarancję i najpierw ustalić/zweryfikować zaufane powiązanie natywnej sesji (rekomendacja koordynatora) albo jawnie dopuścić wariant ręczny z ograniczoną gwarancją i obowiązkiem przechowywania tokenu. Żadnego wariantu nie zatwierdzono. Obecna autoryzacja wymaga zatrzymania przy takiej decyzji; nie uruchomiono kolejnej rundy.

## Dalsze wymagane korekty techniczne

**R03-02 — sprzeczna klasyfikacja odczytów i mutacji.** §5.2 Class P (330–334) i §5.3 (384) zabraniają transakcji/zapisów, lecz te same feature_get i bridge_recover (356–375) zapisują dla attached managera. Nie określono atomowej kontroli aktualnego attached_instance_id wraz z owner-only reconcile; reaping mówi o transakcji, lecz nie wiąże jej jednoznacznie z kontrolą uprawnień. Wykonawca musi zdefiniować osobne gałęzie read-only i guarded mutation, tę drugą z guardem i zapisem w jednej transakcji, oraz zachować wynik odczytu przy równoczesnym takeover. Dodatkowo §4.2 step 6 nadal otwiera migracyjny SqliteStateStore, który zapisuje schema_meta przy każdym otwarciu (sqlite-store.ts:240–245); twierdzenie 379–380 o „single startup write” i test F-01 byte-identical wymagają rozliczenia także tego zapisu, nie tylko boot reap. Bez implementacji nie twierdzimy, że test już został złamany — projekt jest niepełny/sprzeczny.

**R03-03 — per-worktree binding nie jest atomowo zarezerwowany; utrata markera nie jest obsłużona.** Konstruktywny kontrprzykład §4.2: dwa procesy w tym samym świeżym worktree, każdy z innym --db. Krok 3 daje im wspólny workspace_id, ale marker.database=null. W kroku 4 rezerwują dwa różne sidecary, kroki 6–7 tworzą dwie poprawne bazy, krok 8 nadpisuje marker ostatnim wyborem. Brak wspólnej rezerwacji wyboru db przed otwieraniem plików dopuszcza dwa manager_binding w jednym worktree (AC-02/04). Potrzebny jawny protokół rezerwacji jednego db na worktree i test tego przeplotu, oprócz I-13 dla dwóch worktree/jednego db. Ponadto przy utracie A krok 3 tworzy nowy workspace_id; istniejące B/C z poprzednim ID odrzucą oryginalnego właściciela, sprzecznie z §4.1 „C survives losing A or B”. Określić bezpieczną rekonstrukcję z C przed nadaniem nowego ID lub jawne fail-closed bez obietnicy automatycznej odbudowy. Rozstrzygnąć też deklarację „C overrides B” vs odmowę w kroku 4 przed odczytem C, oraz zapis zewnętrznego sidecara w kroku 4 vs zakaz zapisów poza .bridge do kroku 5.

**R03-04 (advisory, docs i ochrona danych):** wariant archive w §4.5 działa tylko dla bazy/sidecara rzeczywiście przenoszonych razem z .bridge. Jawny zewnętrzny --db pozostaje związany ze starą ścieżką i nadal będzie odrzucony. Opisać to ograniczenie i wymóg nowej bazy dla fresh-start, bez utraty poprzedniej. Archiwum .bridge.moved-* nie jest objęte obecnym ignore .bridge/; instrukcja musi zapobiec przypadkowemu commitowi runtime metadata (np. archiwum poza repo). Nie dodawać rebind/installera poza zakresem.

## Rozstrzygnięcia rutynowe i następny krok

Kierunek D-07 (blokada obcego launch/recovery), D-03 (brak cichej adopcji historii) i D-13 (obcy proces nie reapuje/nie zapisuje) mieści się w AC i uwagach R02; nie potrzeba osobnej zgody na te cele. Szczegóły D-13 wymagają R03-02. Nie akceptuje się automatycznie całego D-01..D-13.

Zatrzymanie na Q-02; pozostawione wymagane korekty mogą być przekazane z decyzją, bez ponownej analizy zakończonych rund. Task DONE oznacza dostarczenie paczki, nie PASS review ani akceptację. Po decyzji techniczne poprawki w tej samej sesji przechodzą standardowy workflow dla DONE; nie próbować recovery DONE i nie tworzyć zastępczego taska/sesji dla obejścia stanu. Dalszy sposób wykonania ma respektować decyzję użytkownika i jawne granice workflow.
