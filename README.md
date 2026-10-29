# checkie-translation

체키 성수 게임의 **게임 카드(컨셉·말투·진행 상황)**, **공용 용어집**, **번역·검수 프롬프트**를 팀이 함께 쓰는 사이트입니다.

- 첫 화면은 로그인 화면이에요. 로그인하지 않으면 내용을 볼 수 없습니다.
- 팀원은 **GitHub 계정 없이** 사이트에서 회원가입하고, 관리자가 승인하면 로그인할 수 있습니다.
- 관리자는 승인할 때 **편집자**(수정 가능) 또는 **보기 전용**을 고르고, 언제든 권한 변경·사용 중지·비밀번호 초기화를 할 수 있습니다.
- 사이트는 Render에서 돌아가고, 데이터는 이 GitHub 저장소의 `data` 브랜치에 저장됩니다.
- 모든 수정은 `data` 브랜치에 커밋으로 남아서, 누가 언제 무엇을 바꿨는지 보고 되돌릴 수 있습니다.

## 파일 구성

| 파일 | 역할 |
| --- | --- |
| `server.js` | 서버. 화면을 보여 주고, 회원가입·로그인·승인을 처리하고, GitHub에 저장 |
| `package.json` | Render가 서버를 실행할 때 쓰는 설정 |
| `public/index.html` | 사이트 화면 |
| `public/store.js` | 화면과 서버를 잇는 부분 |
| `data/themes.json`, `data/terms.json` | 처음 데이터 (게임 카드 2개, 용어 13개) |

## 설정하기 (관리자 1회)

### 1. GitHub 저장소 만들기
1. GitHub → **New repository** → 이름 `checkie-translation` → **Private** 선택 → Create.
2. **Add file → Upload files**에서 이 폴더 **안의** 파일과 폴더(`server.js`, `package.json`, `README.md`, `public`, `data`)를 끌어다 놓고 Commit.

### 2. 서버용 GitHub 토큰 만들기
1. GitHub 프로필 → **Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token**
2. **Repository access**: *Only select repositories* → `checkie-translation`
3. **Permissions → Contents**: *Read and write*
4. 만료일은 길게(예: 1년) 잡고 Generate → `github_pat_…` 값을 복사해 둡니다.

이 토큰은 Render 서버에만 넣습니다. 팀원에게 나눠 주지 않습니다.

### 3. Render에 배포하기
1. render.com에 GitHub 계정으로 가입하고, `checkie-translation` 저장소 접근을 허용합니다.
2. **New → Web Service** → `checkie-translation` 저장소 선택
3. 설정
   - **Name**: `checkie-translation` → 주소가 `https://checkie-translation.onrender.com`이 됩니다. (이미 쓰이는 이름이면 뒤에 글자가 붙어요)
   - **Branch**: `main`
   - **Runtime**: Node
   - **Build Command**: 비워 두기 (필수라고 나오면 `npm install`)
   - **Start Command**: `npm start`
   - **Instance Type**: Free
4. **Environment Variables**에 아래를 추가하고 **Deploy**를 누릅니다.

| 이름 | 값 | 필수 |
| --- | --- | --- |
| `GITHUB_TOKEN` | 2번에서 만든 토큰 | 필수 |
| `GITHUB_REPO` | `계정이름/checkie-translation` (예: `xphobia/checkie-translation`) | 필수 |
| `ADMIN_EMAIL` | 관리자 로그인 이메일 (예: yeun@xphobia.net) | 필수 |
| `ADMIN_PASSWORD` | 관리자 비밀번호 (8자 이상) | 필수 |

처음 데이터를 읽을 때 서버가 `data` 브랜치를 자동으로 만듭니다. 회원 목록은 `data/users.json`에 저장되며, 비밀번호는 암호화된 값(해시)으로만 남습니다.

## 회원 가입과 승인

1. 팀원이 사이트 주소를 열면 로그인 화면이 나옵니다. **회원가입** 탭에서 이름·이메일·비밀번호를 넣고 신청합니다.
2. 관리자는 `ADMIN_EMAIL`과 `ADMIN_PASSWORD`로 로그인합니다. **회원 관리** 탭에 승인 대기 수가 표시됩니다.
3. 신청자마다 **편집자로 승인** / **보기 전용으로 승인** / **거절**을 누릅니다.
4. 승인된 팀원은 이제 로그인할 수 있고, 30일 동안 로그인이 유지됩니다.

| 관리자가 할 수 있는 일 | 방법 |
| --- | --- |
| 권한 바꾸기 | 승인된 회원의 드롭다운에서 편집자 ↔ 보기 전용 |
| 사용 중지 | **사용 중지** (바로 로그아웃되고 다시 로그인할 수 없음) |
| 다시 사용 | 사용 중지 목록에서 **다시 사용** |
| 비밀번호 잊은 팀원 | **비밀번호 초기화** → 화면에 나온 임시 비밀번호를 전달 → 팀원이 로그인 후 **비밀번호 변경** |

## 알아 둘 점

- **무료 Render는 15분 동안 아무도 안 쓰면 잠들어요.** 그다음 처음 열 때 30초~1분 정도 기다려야 합니다.
- 관리자 비밀번호는 Render의 Environment에서 `ADMIN_PASSWORD`를 바꾸면 됩니다. 이때 모든 사람의 로그인이 한 번 풀립니다.
- 이메일 발송 기능은 없어요. 가입 승인이나 임시 비밀번호는 메신저 등으로 직접 알려 주세요.
- 서로 다른 항목은 동시에 고쳐도 모두 저장됩니다. **같은 항목**을 동시에 고치면 나중에 저장한 쪽이 남습니다.
- 수정 기록 보기: GitHub 저장소 → 브랜치를 `data`로 바꾸기 → `data/terms.json` → **History**
- 잘못 지운 내용은 History에서 이전 버전을 열어 복사해 되살릴 수 있습니다.
- `main` 브랜치의 `data/*.json`은 처음 데이터일 뿐이에요. 실제 데이터는 `data` 브랜치에 있습니다.
