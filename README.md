# Suno AI 음원 전용 하이브리드 어댑티브 마스터링 & Anti-AI 우회 플랫폼

## 구성
- `backend/` — FastAPI DSP 엔진 (dynamic EQ, 스마트 트랜지언트 셰이퍼, anti-AI 지터/디더, true-peak 리미터 -1.0 dBTP, LUFS 정규화)
- `frontend/` — Next.js + Tailwind CSS 다크모드 대시보드

## 1분 실행 (macOS)
```bash
cd ai-mastering-platform
./start_all.sh
```
최초 실행 시 Python venv 생성 + 패키지 설치, npm install이 자동으로 진행되며
(인터넷 연결 필요), 완료 후 백엔드(8000)·프론트엔드(3000)가 백그라운드로 뜨고
브라우저가 자동으로 http://localhost:3000 을 엽니다.

종료:
```bash
./stop_all.sh
```

## 수동 실행
백엔드:
```bash
cd backend
python3 -m venv venv && source venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

프론트엔드:
```bash
cd frontend
npm install
npm run dev
```

## API
- `POST /api/master` — multipart/form-data: `file`, `prompt`, `bass`, `vocal`,
  `clarity`, `target_lufs`, `anti_ai_intensity` → 처리된 `.wav` 스트리밍 응답
  (응답 헤더 `X-Master-Report`에 측정된 LUFS/트루피크 리포트 포함)
- `GET /api/health` — 헬스체크
- API 문서: http://localhost:8000/docs

## 마스터링 체인 순서
1. Dynamic EQ (Bass/Vocal/Clarity, 프롬프트 키워드로 미세 바이어스)
2. 스마트 트랜지언트 셰이퍼 (자동)
3. Anti-AI 초미세 지터링 + 가우시안 디더링 (강도 슬라이더)
4. LUFS 러프니스 정규화 (목표 LUFS 슬라이더)
5. True-Peak 리미터, 하드 실링 -1.0 dBTP (항상 최종 적용)
