"""Find the requested Chinese glyphs in a click captcha image.

Reads PNG bytes from stdin and prints JSON. No network request is made here.
"""

import json
import sys
from io import BytesIO

import ddddocr
from PIL import Image, ImageEnhance


def png(image):
    output = BytesIO()
    image.save(output, format="PNG")
    return output.getvalue()


def main():
    targets = json.loads(sys.argv[1])
    image = Image.open(BytesIO(sys.stdin.buffer.read())).convert("RGB")
    detector = ddddocr.DdddOcr(det=True, ocr=False, show_ad=False)
    classifier = ddddocr.DdddOcr(show_ad=False)
    found = []
    for box in detector.detection(png(image)):
        x1, y1, x2, y2 = box
        labels = []
        for pad in (0, 4, 8):
            crop = image.crop((
                max(0, x1 - pad), max(0, y1 - pad),
                min(image.width, x2 + pad), min(image.height, y2 + pad),
            ))
            labels.append(classifier.classification(png(crop)))
            labels.append(classifier.classification(png(ImageEnhance.Contrast(crop).enhance(2))))
        found.append({"box": box, "labels": labels})
    points = []
    for target in targets:
        matches = [item for item in found if
                   target in item["labels"] or
                   sum(target in label for label in item["labels"]) >= 2]
        if len(matches) != 1:
            print(json.dumps({"ok": False, "found": found}, ensure_ascii=False))
            return
        left, top, right, bottom = matches[0]["box"]
        points.append({"x": (left + right) / 2, "y": (top + bottom) / 2})
    print(json.dumps({"ok": True, "points": points, "found": found}, ensure_ascii=False))


if __name__ == "__main__":
    main()
