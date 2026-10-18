# 배포 안내 (GitHub Pages + Supabase)

- 화면(정적 파일): `docs/` 폴더 → GitHub Pages (Settings → Pages → main / docs)
  - 학생: `https://hellot4756.github.io/moonjang-lab/`
  - 교사: `https://hellot4756.github.io/moonjang-lab/teacher.html`
- 서버: Supabase Edge Function `ml-api` (프로젝트 `edpzudrzzkjqehjmpbhx`), 데이터는 `ml_*` 테이블
- 교사 비밀번호: Edge Function Secret `TEACHER_PASSWORD` (대시보드에서 직접 입력)
- 서버 코드 수정 후: `python3 edge/build.py` → `edge/dist/ml-api/index.ts`를 다시 배포(verify_jwt 끔)
- 화면 코드 수정 시 `public/`을 고친 뒤 `docs/`로 복사(단, `docs/config.js`는 유지)
- 내 PC에서 쓰는 방식(`start-windows.bat`)은 `public/config.js`가 비어 있어 그대로 동작
