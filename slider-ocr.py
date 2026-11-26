"""Locate the jigsaw target using local image matching."""

import base64
import json
import sys

import cv2
import ddddocr
import numpy as np
from PIL import Image
from io import BytesIO


def main():
    data = json.load(sys.stdin)
    matcher = ddddocr.DdddOcr(det=False, ocr=False, show_ad=False)
    piece = base64.b64decode(data["piece"])
    background = base64.b64decode(data["background"])
    result = matcher.slide_match(piece, background)
    alpha = np.array(Image.open(BytesIO(piece)).convert("RGBA"))[:, :, 3]
    gray = np.array(Image.open(BytesIO(background)).convert("L"))
    piece_edge = cv2.Canny(alpha, 50, 150)
    background_edge = cv2.Canny(gray, 50, 150)
    matches = cv2.matchTemplate(background_edge, piece_edge, cv2.TM_CCORR_NORMED)
    _, score, _, (left, _) = cv2.minMaxLoc(matches)
    result["edge_x"] = left + alpha.shape[1] / 2
    result["edge_score"] = score
    result["agreement"] = abs(result["target_x"] - result["edge_x"]) <= 8
    print(json.dumps(result))


if __name__ == "__main__":
    main()
