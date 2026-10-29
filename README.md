# 체키 번역 프롬프트 카드

체키 성수 게임의 **게임 카드(컨셉·말투·진행 상황)**, **공용 용어집**, **번역·검수 프롬프트**를 팀이 함께 쓰는 웹사이트입니다.
GitHub Pages로 배포하고, 데이터는 이 저장소의 `data/` 폴더에 JSON 파일로 저장됩니다.

## 파일 구성

| 파일 | 역할 |
| --- | --- |
| `index.html` | 사이트 화면 |
| `gh-store.js` | GitHub 저장소를 읽고 쓰는 부분 |
| `config.js` | 저장소 정보 설정 (보통은 비워 둬도 됨) |
| `data/themes.json` | 게임 카드 데이터 |
| `data/terms.json` | 용어집 데이터 |

## 처음 설정하기 (관리자 1회)

1. **저장소 만들기**
   GitHub에서 **New repository** → 이름 예: `checkie-translation` → **Public** 선택 → Create.
   - 무료 계정에서 GitHub Pages는 Public 저장소만 쓸 수 있어요. Private로 하려면 GitHub Team 이상 요금제가 필요합니다.
   - Public이면 사이트 주소를 아는 누구나 내용을 볼 수 있어요. 출시 전 게임 문구를 올려도 되는지 먼저 확인해 주세요.
2. **파일 올리기**
   저장소 화면에서 **Add file → Upload files** → 이 폴더의 파일과 `data` 폴더를 통째로 끌어다 놓기 → Commit changes.
3. **사이트 켜기**
   **Settings → Pages** → Source: *Deploy from a branch* → Branch: `main` / `/ (root)` → Save.
   1~2분 뒤 `https://<계정>.github.io/checkie-translation/` 주소로 열립니다.
4. **팀원 초대**
   **Settings → Collaborators → Add people**로 수정할 팀원을 초대합니다. (조직 저장소라면 팀에 Write 권한)

## 수정하는 방법 (팀원 각자 1회)

보기만 할 때는 주소만 열면 됩니다. 수정하려면 각자 GitHub 토큰으로 **편집 로그인**을 합니다.

1. GitHub 오른쪽 위 프로필 → **Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token**
2. **Repository access**: *Only select repositories* → 이 저장소 선택
3. **Permissions → Repository permissions → Contents**: *Read and write*
4. 만든 토큰(`github_pat_…`)을 복사해서 사이트 오른쪽 위 **편집 로그인**에 붙여 넣기

토큰은 그 브라우저에만 저장됩니다. 공용 PC에서는 사용 후 **로그아웃**을 눌러 주세요.

## 쓰는 방법

- **게임 카드**: 칸을 고치고 다른 곳을 누르면 자동 저장됩니다. 진행 상황은 단계 버튼만 누르면 됩니다.
- **용어집**: 맨 아래 **+ 용어 추가**를 누를 때마다 빈 줄이 생깁니다. 원문을 입력하면 저장됩니다. 번역 아래 버튼으로 **후보 ↔ 확정**을 바꾸고, **더보기**에서 금지 번역과 메모를 적습니다.
- **프롬프트**: 게임과 언어를 고르고 **복사**를 눌러 AI에 붙여 넣습니다. 그 게임의 카드와 용어집이 자동으로 들어갑니다.

## 알아 둘 점

- 수정한 내용은 1~2초 뒤 GitHub에 커밋으로 저장됩니다. 모든 수정 기록이 저장소의 **커밋 이력**에 남아서, 잘못 지운 내용도 되돌릴 수 있어요.
- 다른 사람이 고친 내용은 1분마다 자동으로 받아옵니다. 바로 보려면 새로고침하세요.
- 서로 다른 항목은 동시에 고쳐도 둘 다 저장됩니다. **같은 항목**을 동시에 고치면 나중에 저장한 쪽이 남습니다.
- 로그인하지 않은 사람은 GitHub Pages에 배포된 파일을 읽기 때문에, 방금 저장한 내용이 몇 분 늦게 보일 수 있어요.
- 데이터는 `data/*.json`을 GitHub에서 직접 고쳐도 됩니다. JSON 형식만 깨지지 않게 주의해 주세요.
