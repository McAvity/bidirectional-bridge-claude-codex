# Niezależne review kontraktu po recovery — REWORK

Wznowienie technicznie powiodło się: ta sama sesja i task, próba 1 z próby 0. Wykonawca dostarczył proponowany kontrakt, lecz zakończył BLOCKED/PARTIAL z powodu eksportera. Dokument wymaga korekt poniżej; nie jest gotowy do implementacji ani przyjęty. Nie uruchomiono kolejnego recovery. Review bezpośrednio z repo jest możliwe mimo braku paczki, ale nie zastępuje wymaganego verify.

## Zakres i niezależność

Reviewer: koordynator Codex, niezależny od wykonawcy Claude, nie od koordynacji. Task task_<historical-10>, W7-ID-01. Przeczytano kontrakt, ledger, brief/design, decyzje 01–02 i wskazane źródła. Produkt pozostaje na bazie aeb92c2; wdrożony timeout-recovery był osobną zmianą runtime, nie implementacją izolacji.

Zmiany wykonawcy: fe33aa06a4c28ad244be4ffc376c0806b686299d..f978b69bc4cb70189d67c13d712e800f23ecf16a — wyłącznie contracts/identity.md oraz execution/W7-ID-01/01.md. Git był czysty po dostawie. Starsze commity 3d9325f, 3f163f1, 1ff15d0, fe33aa0 w zakresie pierwotnego base e5cc93a są znanymi zapisami koordynatora; nie są naruszeniem zakresu przez Claude’a.

SHA-256 kontraktu: d89379569ee80aeb4271e8180c8754e3b75649c3b62f1f6945066721dadcf7f0.
SHA-256 ledgera: 045c8127caf4619c36809f9cbe171a2d0c5d42b659250187feb21feeb7e244d2.

## Ustalenia wymagane

**R02-01 — paczka niedostarczona (blokada narzędzia/planowania, nie samowolne odstępstwo wykonawcy).**
Eksport odtworzono niezależnie: exit 1, „Task must be a Markdown path under work-items/: docs/tasks/wave7-identity-01.md”. Eksporter w liniach 118–121 oraz walidator manifestu 216–218 narzucają work-items/, a plan świadomie wybrał docs/tasks/. Nie powstał ZIP, verify nie uruchomiono. Koordynator nie wykrył tej niezgodności przed pierwszą rundą. Wymagane: uzgodniona naprawa wspólnego eksportera i testów obsługująca świadomy fallback albo jawna zmiana warunku paczki. Nie przenosić tasków wyłącznie dla obejścia błędu bez oceny workflow. Ta naprawa i kolejna próba nie mieszczą się w wykorzystanej zgodzie na JEDNO recovery.

**R02-02 — AC-02/AC-05: mutacje poza kontrolą managera.**
Kontrakt §5.2, linia 256, klasyfikuje bridge_recover i bridge_feature_get jako Read / No guard. Faktyczny ControlPlane.recover (control-plane.ts:135) wywołuje leases.reapExpired; lifecycle.ts:59 robi to również podczas startu. FeatureWorkflow.get (feature-workflow.ts:68–69) wywołuje refresh, który zapisuje stan/event przez save. Drugi lub odłączony manager może zatem zmieniać wspólny stan pomimo deklaracji „blocked before mutation”. Wymagane: rozdzielić czyste odczyty od mutacji oraz określić uprawnienia i atomowość boot recovery / refresh; dopisać test obcego procesu, porównujący stan i eventy, nie tylko brak startu adaptera. Samo sprawdzenie istniejącej macierzy narzędzi nie wystarczy.

**R02-03 — AC-04/AC-05: legacy adoption zmienia wymaganie izolacji.**
§10 (363–374), D-03: skopiowana baza schema 4 zostaje automatycznie przyjęta. Ostrzeżenie nie spełnia kryterium odrzucenia przypadkowo współdzielonego/skopiowanego stanu. Uzasadnienie „strict resume fail jest benign” nie obejmuje odczytu cudzych pytań/artefaktów ani featura przed pierwszą rundą, który nie ma jeszcze uchwytu do sprawdzenia; sam kontrakt oznacza zachowanie cwd jako V-2 unverified. Wymagane: bezpieczna, jawna adopcja lub blokada niepowiązanej bazy z historią, test skopiowanego legacy waiting_user/feature bez rund oraz osobna decyzja, jeśli chce się poluzować AC-04. D-03 nie można uznać za rutynowo zaakceptowany wybór tylko dlatego, że kontrakt twierdzi „No blocking user decision”.

**R02-04 — AC-06: nieskuteczna instrukcja dla moved worktree.**
D-11/§16 (543–544) wskazuje usunięcie workspace.json jako rozwiązanie. W §4 kroku 4 (161–165) zachowana baza nadal zawiera stary root/git_dir i zostanie odrzucona także bez markera. Wymagane: spójna, niedestrukcyjna instrukcja (np. powrót do oryginalnej ścieżki lub jawnie odroczony rebind), bez zalecania kasowania stanu; test pokazujący, że wskazany sposób rzeczywiście działa. Nie trzeba dodawać rebind narzędzia do tego zakresu, lecz nie wolno obiecywać nieistniejącego obejścia.

## Pozostałe decyzje i uwagi

- **R02-05 (wymagane doprecyzowanie AC-03):** §9 dopuszcza null/advisory native_session_id, a §6 zakłada, że token przetrwa w rozmowie. To identyfikuje posiadacza tokenu, lecz bez dodatkowej procedury nie dowodzi wyboru dokładnej natywnej sesji managera po restarcie/utracie kontekstu. Określić wymagane źródło/persistencję danych do resume, zachowanie przy braku tokenu i dowód restartu; nie oznaczać AC-03 spełnionym samym statycznym zakazem skanowania cwd. Nie rozstrzygano za użytkownika zmiany wymagań.
- **R02-06 (advisory, provenance):** ledger podaje Final commit 2f7f9a5, podczas gdy dostarczony HEAD to f978b69. Zakres i autorstwo da się ustalić z Git, więc nie blokuje odczytu, ale kolejny ledger powinien wskazać poprawny commit bez przepisywania wcześniejszego rekordu. Faktycznie wznowiona próba to 1, poprzednia 0 TIMEOUT.
- D-07 (zakaz obcego launch/recovery podczas aktywnego managera) odpowiada intencji izolacji, lecz dokładna macierz musi uwzględnić R02-02. Nie zatwierdzono całego zestawu D-01–D-12.
- §4 nie określa wystarczająco serializacji dwóch różnych worktree wskazujących ten sam jeszcze nieutworzony --db: oba mogą minąć preflight przed DDL. Przed implementacją doprecyzować kolejność blokady/adopcji i dodać wariant równoczesnego bootstrapu różnych worktree; I-11 obejmuje tylko jedno worktree. Nie twierdzimy, że nieistniejąca implementacja już naruszyła tę regułę.

## Dowody i dyspozycja

R01-01: **progress** — istnieje rzeczywisty kontrakt i lokalny commit, brak paczki nadal nierozwiązany (R02-01). Kontrakt ma użyteczny model roli/session, przypisanie workspace i macierz scenariuszy; nie są one testami wykonanymi. AC-01–07 dla produktu pozostają unverified, a powyższe luki blokują gotowość kontraktu.

Wykonano: git diff --check fe33aa0..f978b69 (exit 0), sprawdzenie zakresu/clean tree, niezależny export z oryginalnym base/purpose/output (exit 1). Nie uruchamiano verify nieistniejącej paczki ani build/test produktu — zmieniono wyłącznie dokumenty. Weryfikacja recovery to osobny fakt: same_execution_handle=true, attempt 1/resumed_from_attempt 0, runtime exit 0, lease RELEASED. To nie daje taskowi DONE ani kontraktowi PASS.

Następny krok: decyzja o usunięciu blokady eksportera i korektach kontraktu, potem osobno autoryzowane wznowienie tego samego BLOCKED taska. Żadnej zastępczej rundy/sesji, implementacji ani przyjęcia dostawy w tym kroku. Review/checkpoint pozostają niecommitowane, ponieważ bridge-loop.md zabrania commitów koordynatora, gdy task rundy jest BLOCKED; zapisy poza zakresem wykonawcy są rozdzielone i chronione lease’em.
