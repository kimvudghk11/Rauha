# 캐릭터 그림 만드는 법

2026-11-08. 앱 캐릭터 22마리(`packages/desktop/src/renderer/assets/characters/`, 역할 → 그림은 같은 폴더의 `characters.json`)는 사용자의 AWS Bedrock으로 그린 그림이다. 마음에 안 드는 마리만 다시 뽑을 수 있게 방법을 적어 둔다.

## 모델과 호출

- 모델: `stability.stable-image-ultra-v1:1` (글자만으로 그리기). 리전 `us-west-2`, AWS 프로필 `default`(aws configure). 같은 계정의 zzenddo-plugin도 같은 리전·Stability 모델을 쓴다.
- 호출: `aws bedrock-runtime invoke-model --model-id stability.stable-image-ultra-v1:1 --body fileb://요청.json --cli-binary-format raw-in-base64-out --region us-west-2 --profile default 응답.json`
- 요청 본문: `{ "prompt": ..., "negative_prompt": ..., "aspect_ratio": "1:1", "output_format": "png" }`. 응답의 `images[0]`이 base64 PNG.
- 비용: 한 장에 몇십 센트가 아니라 대략 0.14달러 안팎으로 보고 있다(제 추정, 청구서로 확인하지 않음). 마음에 드는 그림이 안 나와 다시 뽑을 때 쌓인다.
- 써 보고 버린 것: `us.stability.stable-image-style-guide-v1:0`(돌고래 그림을 그림체 참고로 넣기). 색이 돌고래 파랑으로 번지고 윤곽선이 얇아서 버렸다. 이 모델은 모델 ID가 아니라 추론 프로필 ID(`us.` 접두사)로 불러야 한다.

## 문장

```
kawaii sticker illustration of a cute chubby {동물 설명}, very round simple chibi shape,
BOLD THICK dark navy marker outline around the entire body, soft flat watercolor fill with
paper texture, two tiny black dot eyes each with a white highlight, soft pink blush circles,
tiny omega-shaped smile, pastel colors, full body, centered, isolated on a pure white (#FFFFFF)
background, white page, no ground, no shadow, no text
```

negative_prompt:

```
wooden table, wood, desk, card, frame, app icon, rounded square, border box, colored background,
lavender background, thin lines, sketch, realistic, natural history illustration, botanical, ground,
floor, shadow, splatter, droplets, bubbles, text, letters, watermark, logo, photo, 3d render,
multiple characters, scenery, gradient background
```

- 같은 문장으로 뽑아도 매번 다르게 나온다. 배경에 색이나 나무 탁자, 카드 틀이 생기면 다시 뽑는다(22마리 중 5마리가 한 번은 그랬다).
- 동물 설명에는 색을 꼭 적는다(예: `a baby sea turtle, soft mint green shell with a cream belly`). 그림체 참고 이미지를 넣지 않아서 색은 글자로만 정해진다.

## 배경 지우기

흰 바탕에서 가장자리와 이어진 밝은 곳(RGB 최솟값 205 이상)만 지운다. 몸 안쪽 흰 배는 윤곽선이 막고 있어서 남는다. 스티커의 흰 테두리와 옅은 그림자 일부는 남아서 어두운 앱 바탕 위에서 스티커처럼 보인다. 앱에서는 가로 384px 이하로 줄여서 쓴다.
