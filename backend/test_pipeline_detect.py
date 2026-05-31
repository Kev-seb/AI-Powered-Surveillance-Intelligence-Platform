import cv2
from ml.pipeline.detector import PersonDetector
from app.core.config import settings

def test_detect():
    video_path = "/app/uploads/8a209660-ff30-40ec-90f8-5e2b361a56a5.mp4"
    detector = PersonDetector(
        model_path=settings.YOLO_MODEL,
        confidence=0.15, # Try lower confidence to see if anything gets hit
    )
    
    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        print("Cannot open video file")
        return
        
    print(f"Video opened. Total frames: {int(cap.get(cv2.CAP_PROP_FRAME_COUNT))}")
    
    frame_idx = 0
    detected_any = False
    while True:
        ret, frame = cap.read()
        if not ret:
            break
        frame_idx += 1
        
        if frame_idx % 30 == 0:
            print(f"Testing frame {frame_idx}...")
            detections = detector.detect(frame, detect_faces=True)
            if detections:
                detected_any = True
                print(f"  Frame {frame_idx} detections:")
                for d in detections:
                    print(f"    Class: {d['class_name']}, Conf: {d['confidence']:.2f}, BBox: {d['bbox']}")
            else:
                print(f"  Frame {frame_idx}: No detections")
                
        if frame_idx >= 300:
            break
            
    cap.release()
    if not detected_any:
        print("Absolutely no detections across 300 frames!")

if __name__ == "__main__":
    test_detect()
