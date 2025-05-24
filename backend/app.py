import sqlite3
import os
from datetime import datetime
import time
import numpy as np
import cv2
import pickle
from flask import Flask, request, jsonify, Response
from flask_cors import CORS
from werkzeug.utils import secure_filename
import base64
from insightface.app import FaceAnalysis

app = Flask(__name__)
# Cấu hình CORS cho tất cả các endpoint
CORS(app, resources={r"/*": {"origins": "*"}})

DATABASE = os.path.join(os.path.abspath(os.path.dirname(__file__)), 'dtb.db')
BASE_DIR = os.path.abspath(os.path.dirname(__file__))
dataset_dir = os.path.abspath(os.path.join(BASE_DIR, '..', 'dataset'))
embeddings_path = os.path.join(BASE_DIR, 'face_embeddings.pkl')

os.makedirs(dataset_dir, exist_ok=True)

face_app = FaceAnalysis(name="buffalo_l", providers=["CPUExecutionProvider"])
face_app.prepare(ctx_id=0, det_size=(640, 640), det_thresh=0.6)

recognized_faces = {}
start_time = time.time()

# --- Nhận diện khuôn mặt từ ảnh tĩnh ---
def recognize_faces(img):
    faces = face_app.get(img)
    recognized = []
    if os.path.exists(embeddings_path):
        with open(embeddings_path, 'rb') as f:
            embeddings = pickle.load(f)
    else:
        embeddings = {}
    threshold = 0.5
    for face in faces:
        emb = face.normed_embedding
        max_sim = -1
        best_name = "Unknown"
        for name, embs in embeddings.items():
            for saved_emb in embs:
                sim = np.dot(emb, saved_emb)
                if sim > max_sim:
                    max_sim = sim
                    best_name = name
        if max_sim >= threshold:
            recognized.append(best_name)
    return list(set(recognized))

# --- API upload ảnh sinh viên ---
@app.route('/api/upload', methods=['POST'])
def upload():
    student_name = request.form.get('student_name')
    if not student_name:
        return jsonify({'status': 'error', 'message': 'Chưa cung cấp tên học sinh'}), 400
    file = request.files.get('image')
    if file is None:
        return jsonify({'status': 'error', 'message': 'Chưa tải ảnh lên'}), 400
    student_folder = os.path.join(dataset_dir, student_name)
    os.makedirs(student_folder, exist_ok=True)
    filename = secure_filename(file.filename)
    if filename == '':
        return jsonify({'status': 'error', 'message': 'Tên file không hợp lệ'}), 400
    save_path = os.path.join(student_folder, filename)
    file.save(save_path)
    return jsonify({'status': 'success', 'message': 'Ảnh đã được lưu'}), 200

# --- Xử lý yêu cầu OPTIONS cho /api/recognize ---
@app.route('/api/recognize', methods=['OPTIONS'])
def recognize_options():
    response = Response()
    response.headers['Access-Control-Allow-Origin'] = '*'
    response.headers['Access-Control-Allow-Methods'] = 'POST'
    response.headers['Access-Control-Allow-Headers'] = 'Content-Type'
    return response, 200

# --- API điểm danh bằng ảnh base64 ---
@app.route('/api/recognize', methods=['POST'])
def recognize():
    data = request.get_json()
    if not data or 'image' not in data:
        return jsonify({'status': 'error', 'message': 'Dữ liệu không đúng'}), 400

    img_data = data['image']
    if not img_data:
        return jsonify({'status': 'error', 'message': 'Dữ liệu ảnh rỗng'}), 400

    if ',' in img_data:
        img_data = img_data.split(',', 1)[1]
    try:
        img_bytes = base64.b64decode(img_data)
        np_arr = np.frombuffer(img_bytes, np.uint8)
        if np_arr.size == 0:
            return jsonify({'status': 'error', 'message': 'Không thể giải mã ảnh, dữ liệu rỗng'}), 400
        img = cv2.imdecode(np_arr, cv2.IMREAD_COLOR)
        if img is None:
            return jsonify({'status': 'error', 'message': 'Không đọc được ảnh'}), 400
        names = recognize_faces(img)
        return jsonify({'recognized': names}), 200
    except Exception as e:
        return jsonify({'status': 'error', 'message': f'Lỗi khi xử lý ảnh: {str(e)}'}), 500

# --- API stream video (nhận diện thời gian thực) ---
def gen_frames():
    global recognized_faces, start_time
    cap = cv2.VideoCapture(0)
    if not cap.isOpened():
        raise RuntimeError("Không thể mở webcam")

    if os.path.exists(embeddings_path):
        with open(embeddings_path, 'rb') as f:
            embeddings = pickle.load(f)
    else:
        embeddings = {}

    while True:
        success, frame = cap.read()
        if not success:
            break

        faces = face_app.get(frame)

        for face in faces:
            box = face.bbox.astype(int)
            emb = face.normed_embedding
            name = "Unknown"
            max_sim = -1

            for person_name, person_embs in embeddings.items():
                for saved_emb in person_embs:
                    sim = np.dot(emb, saved_emb)
                    if sim > max_sim:
                        max_sim = sim
                        name = person_name
            if max_sim < 0.5:
                name = "Unknown"

            if name != "Unknown" and name not in recognized_faces:
                recognized_faces[name] = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
                print(f"-> Ghi nhận: {name}")

            # Vẽ khung
            cv2.rectangle(frame, (box[0], box[1]), (box[2], box[3]), (0, 255, 0), 2)
            cv2.putText(frame, name, (box[0], box[1] - 10),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.8, (0, 255, 0), 2)

        # Hiện thời gian và số người
        now_str = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        cv2.putText(frame, now_str, (10, 30), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0,255,255), 2)
        cv2.putText(frame, f"So nguoi: {len(faces)}", (10, 60), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0,0,255), 2)

        # Encode frame thành MJPEG
        ret, buffer = cv2.imencode('.jpg', frame)
        frame_bytes = buffer.tobytes()
        yield (b'--frame\r\n'
               b'Content-Type: image/jpeg\r\n\r\n' + frame_bytes + b'\r\n')

    cap.release()

@app.route('/stream')
def stream():
    return Response(gen_frames(), mimetype='multipart/x-mixed-replace; boundary=frame')

def get_db_connection():
    conn = sqlite3.connect(DATABASE)
    conn.row_factory = sqlite3.Row
    return conn

@app.route('/api/schedule', methods=['GET'])
def get_schedule():
    conn = get_db_connection()
    cursor = conn.cursor()
    query = """
        SELECT 
            sub.Name_Subject AS subject_name,
            cls.NameClass AS class_name,
            tt.Day_of_week AS day_of_week,
            tt.Start_Time AS start_time,
            tt.End_Time AS end_time,
            tt.ID_Class AS class_id,
            tt.ID AS timetable_id
        FROM Time_Table tt
        LEFT JOIN Subject sub ON tt.ID_Subject = sub.ID
        LEFT JOIN Classes cls ON tt.ID_Class = cls.ID
    """
    cursor.execute(query)
    rows = cursor.fetchall()
    conn.close()

    day_mapping = {
        "thu 2": "Thứ 2",
        "thu 3": "Thứ 3",
        "thu 4": "Thứ 4",
        "thu 5": "Thứ 5",
        "thu 6": "Thứ 6",
        "thu 7": "Thứ 7",
        "chu nhat": "Chủ nhật"
    }

    schedule_list = []
    for row in rows:
        day_of_week = row['day_of_week'] if row['day_of_week'] else 'Chưa xác định'
        day_of_week_lower = day_of_week.lower()
        day_of_week = day_mapping.get(day_of_week_lower, day_of_week)
        time_str = f"{day_of_week} {row['start_time']}-{row['end_time']}"
        schedule_list.append({
            "subject": row["subject_name"] or "Chưa có môn học",
            "class": row["class_name"] or "Chưa có lớp",
            "time": time_str,
            "class_id": row["class_id"],
            "timetable_id": row["timetable_id"]
        })
    print(f"Dữ liệu từ API: {schedule_list}")
    return jsonify(schedule_list)

@app.route('/api/class/<int:class_id>/students', methods=['GET'])
def get_students(class_id):
    conn = get_db_connection()
    cursor = conn.cursor()
    query = """
        SELECT MSV, FullName
        FROM Student
        WHERE ID_Class = ?
    """
    cursor.execute(query, (class_id,))
    rows = cursor.fetchall()
    conn.close()

    student_list = []
    for row in rows:
        student_list.append({
            "MSV": row["MSV"],
            "FullName": row["FullName"]
        })
    return jsonify(student_list)

@app.route('/api/save_attendance', methods=['POST'])
def save_attendance():
    data = request.get_json()
    if not data or 'timetable_id' not in data or 'data' not in data:
        return jsonify({'status': 'error', 'message': 'Dữ liệu không hợp lệ'}), 400

    timetable_id = data['timetable_id']
    attendance_data = data['data']
    attendance_date = datetime.now().strftime('%Y-%m-%d %H:%M:%S')

    print("Dữ liệu nhận được:", data)

    try:
        conn = get_db_connection()
        cursor = conn.cursor()

        for record in attendance_data:
            status = record['Status']
            if status not in ['Present', 'Absent']:
                return jsonify({'status': 'error', 'message': 'Giá trị Status không hợp lệ, phải là "Present" hoặc "Absent"'}), 400

            cursor.execute("""
                INSERT INTO Attendance (ID_TimeTable, MSV, Status, Attendance_Date)
                VALUES (?, ?, ?, ?)
            """, (timetable_id, record['MSV'], status, attendance_date))

        conn.commit()
        conn.close()
        return jsonify({'status': 'success', 'message': 'Đã lưu điểm danh thành công'}), 200
    except sqlite3.Error as e:
        return jsonify({'status': 'error', 'message': f'Lỗi khi lưu điểm danh: {str(e)}'}), 500

if __name__ == '__main__':
    app.run(debug=True)