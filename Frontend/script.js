const navUpload = document.getElementById("nav-upload");
const navSchedule = document.getElementById("nav-schedule");
const pageUpload = document.getElementById("page-upload");
const pageSchedule = document.getElementById("page-schedule");
const pageAttendance = document.getElementById("page-attendance");
const scheduleTable = document.getElementById("scheduleTable");
const studentList = document.getElementById("studentList");
const subjectName = document.getElementById("subjectName");
const className = document.getElementById("className");
const streamFrame = document.getElementById("streamFrame");
const videoContainer = document.getElementById("videoContainer");
const saveAttendanceBtn = document.getElementById("saveAttendance");
const startFaceRecognitionBtn = document.getElementById("startFaceRecognition");
const hiddenCanvas = document.getElementById("hiddenCanvas");
const successNotification = document.getElementById("successNotification");
const successMessage = document.getElementById("successMessage");

// Modal elements
const statusModalElement = document.getElementById("statusModal");
const statusModal = new bootstrap.Modal(statusModalElement);
const statusIcon = document.getElementById("statusIcon");
const statusMessage = document.getElementById("statusMessage");

let recognizedStudents = new Set();
let currentClassId = null;
let currentTimetableId = null;
let studentMap = new Map();
let recognitionInterval = null;
let isSaving = false;

function showPage(page) {
  [pageUpload, pageSchedule, pageAttendance].forEach((p) =>
    p.classList.add("hidden")
  );
  page.classList.remove("hidden");
}

function showSuccessNotification(message) {
  successMessage.textContent = message;
  successNotification.classList.remove("hidden");
  setTimeout(() => {
    successNotification.classList.add("hidden");
  }, 3000);
}

function showStatusModal(isSuccess, message) {
  console.log(
    "Hiển thị modal với thông điệp:",
    message,
    "Trạng thái:",
    isSuccess
  );
  statusMessage.textContent = message;
  statusIcon.innerHTML = isSuccess
    ? `
        <svg class="checkmark" viewBox="0 0 52 52">
          <circle class="checkmark-circle" cx="26" cy="26" r="25" />
          <path class="checkmark-check" d="M14.1 27.2l7.1 7.2 16.7-16.8" />
        </svg>
      `
    : `
        <svg class="error-x" viewBox="0 0 52 52">
          <path d="M16 16 36 36" />
          <path d="M36 16 16 36" />
        </svg>
      `;
  statusIcon.className = "status-icon " + (isSuccess ? "success" : "error");
  statusModal.show();
}

// Xử lý khi modal đóng để xóa focus
statusModalElement.addEventListener("hidden.bs.modal", () => {
  if (
    document.activeElement &&
    statusModalElement.contains(document.activeElement)
  ) {
    document.activeElement.blur();
  }
  statusModalElement.setAttribute("aria-hidden", "true");
});

navUpload.onclick = (e) => {
  e.preventDefault();
  e.stopImmediatePropagation();
  showPage(pageUpload);
  navUpload.classList.add("active");
  navSchedule.classList.remove("active");
  streamFrame.src = "";
};

navSchedule.onclick = (e) => {
  e.preventDefault();
  e.stopImmediatePropagation();
  showPage(pageSchedule);
  navUpload.classList.remove("active");
  navSchedule.classList.add("active");
  fetchSchedule();
  streamFrame.src = "";
};

async function fetchSchedule() {
  try {
    const res = await fetch("http://127.0.0.1:5000/api/schedule", {
      headers: { "X-Requested-With": "XMLHttpRequest" },
    });
    const data = await res.json();
    console.log("Dữ liệu từ API:", data);
    renderSchedule(data);
  } catch (error) {
    console.error("Error fetching schedule:", error);
    scheduleTable.innerHTML =
      "<tr><td colspan='8'>Lỗi khi tải thời khóa biểu</td></tr>";
  }
}

function renderSchedule(data) {
  console.log("Bắt đầu render với dữ liệu:", data);

  if (!Array.isArray(data) || data.length === 0) {
    console.error("Dữ liệu lịch học rỗng");
    scheduleTable.innerHTML =
      '<tr><td colspan="8" class="text-center py-4">Không có dữ liệu lịch học</td></tr>';
    return;
  }

  const normalizeDay = (str) => {
    return str
      .trim()
      .toLowerCase()
      .replace(/(thứ\s*|chủ\s*)/, (match) => match.replace(/\s/g, ""))
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "");
  };

  const daysOfWeek = [
    "Thứ 2",
    "Thứ 3",
    "Thứ 4",
    "Thứ 5",
    "Thứ 6",
    "Thứ 7",
    "Chủ nhật",
  ];
  const timeSlots = Array.from({ length: 11 }, (_, i) => {
    const hour = 7 + i;
    return `${hour}:00-${hour + 1}:00`;
  });

  const occupiedSlots = {};
  scheduleTable.innerHTML = "";

  timeSlots.forEach((timeSlot, slotIndex) => {
    const row = document.createElement("tr");
    const timeCell = document.createElement("td");
    timeCell.textContent = timeSlot;
    timeCell.className = "time-slot";
    row.appendChild(timeCell);

    daysOfWeek.forEach((day) => {
      const slotKey = `${day}-${slotIndex}`;
      if (occupiedSlots[slotKey]) return;

      const cell = document.createElement("td");
      cell.className = "class-cell empty";

      const scheduleItem = data.find((item) => {
        if (!item?.time) {
          console.warn("Mục không có thời gian:", item);
          return false;
        }

        const parts = item.time.split(" ");
        if (parts.length < 3) {
          console.warn("Định dạng thời gian không hợp lệ:", item.time);
          return false;
        }

        const itemDay = parts.slice(0, -1).join(" ");
        const timeRange = parts[parts.length - 1];

        if (!timeRange.includes("-")) {
          console.warn("Khoảng thời gian không hợp lệ:", timeRange);
          return false;
        }

        const [startTime, endTime] = timeRange.split("-");
        const slotStartHour = parseInt(timeSlot.split("-")[0].split(":")[0]);
        const itemStartHour = parseInt(startTime.split(":")[0]);
        const itemEndHour = parseInt(endTime.split(":")[0]);

        return (
          normalizeDay(itemDay) === normalizeDay(day) &&
          slotStartHour >= itemStartHour &&
          slotStartHour < itemEndHour
        );
      });

      if (scheduleItem) {
        console.log("Tìm thấy môn học:", scheduleItem);
        const parts = scheduleItem.time.split(" ");
        const timeRange = parts[parts.length - 1];
        const [startTime, endTime] = timeRange.split("-");
        const startHour = parseInt(startTime.split(":")[0]);
        const endHour = parseInt(endTime.split(":")[0]);
        const rowspan = endHour - startHour;

        cell.className = `class-cell type-${scheduleItem.class_id % 5 || 1}`;
        cell.innerHTML = `
                      <div class="fw-semibold">${scheduleItem.subject}</div>
                      <div class="text-muted small">${scheduleItem.class}</div>
                      <div class="text-muted small mt-1">${
                        scheduleItem.time.split(" ")[1]
                      }</div>
                  `;
        cell.setAttribute("data-class-id", scheduleItem.class_id);
        cell.setAttribute("data-timetable-id", scheduleItem.timetable_id);
        cell.setAttribute("data-subject", scheduleItem.subject);
        cell.addEventListener("click", () => handleScheduleClick(scheduleItem));

        if (rowspan > 1) {
          cell.setAttribute("rowspan", rowspan);
          for (let i = 1; i < rowspan; i++) {
            occupiedSlots[`${day}-${slotIndex + i}`] = true;
          }
        }
      }

      row.appendChild(cell);
    });

    scheduleTable.appendChild(row);
  });
}

async function handleScheduleClick(item) {
  subjectName.innerText = item.subject;
  className.innerText = item.class;
  currentClassId = item.class_id;
  currentTimetableId = item.timetable_id;
  showPage(pageAttendance);
  videoContainer.classList.add("hidden");
  streamFrame.src = "";
  if (recognitionInterval) {
    clearInterval(recognitionInterval);
    recognitionInterval = null;
  }
  recognizedStudents.clear();
  studentMap.clear();
  studentList.innerHTML = "";
  await fetchStudents(item.class_id);
}

async function fetchStudents(classId) {
  try {
    const res = await fetch(
      `http://127.0.0.1:5000/api/class/${classId}/students`,
      {
        headers: { "X-Requested-With": "XMLHttpRequest" },
      }
    );
    const data = await res.json();
    studentList.innerHTML = "";
    data.forEach((student) => {
      const tr = document.createElement("tr");
      tr.setAttribute("data-msv", student.MSV);
      tr.innerHTML = `
                  <td>${student.MSV}</td>
                  <td>${student.FullName}</td>
                  <td class="status"><input type="checkbox" class="status-checkbox" data-msv="${student.MSV}"></td>
              `;
      studentList.appendChild(tr);
      studentMap.set(student.MSV, tr);
    });

    document.querySelectorAll(".status-checkbox").forEach((checkbox) => {
      checkbox.addEventListener("change", (event) => {
        const msv = event.target.getAttribute("data-msv");
        if (event.target.checked) {
          recognizedStudents.add(msv);
        } else {
          recognizedStudents.delete(msv);
        }
      });
    });
  } catch (error) {
    console.error("Error fetching students:", error);
    studentList.innerHTML =
      "<tr><td colspan='3'>Lỗi khi tải danh sách sinh viên</td></tr>";
  }
}

function captureFrameToBase64() {
  return new Promise((resolve, reject) => {
    const img = streamFrame;
    img.crossOrigin = "Anonymous";
    img.onload = () => {
      const canvas = hiddenCanvas;
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0);
      const base64 = canvas.toDataURL("image/jpeg");
      resolve(base64);
    };
    img.onerror = () => {
      reject(new Error("Không thể tải ảnh từ stream"));
    };
    if (img.complete) {
      img.onload();
    }
  });
}

function startRecognitionPolling() {
  recognitionInterval = setInterval(async () => {
    if (
      !pageAttendance.classList.contains("hidden") &&
      !videoContainer.classList.contains("hidden")
    ) {
      try {
        const base64Image = await captureFrameToBase64();
        const res = await fetch("http://127.0.0.1:5000/api/recognize", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Requested-With": "XMLHttpRequest",
          },
          body: JSON.stringify({ image: base64Image }),
        });
        const data = await res.json();
        console.log("Recognized MSVs:", data.recognized);
        if (data.recognized) {
          data.recognized.forEach((msv) => {
            if (studentMap.has(msv) && !recognizedStudents.has(msv)) {
              recognizedStudents.add(msv);
              const row = studentMap.get(msv);
              if (row) {
                const checkbox = row.querySelector(".status-checkbox");
                if (checkbox && !checkbox.checked) {
                  checkbox.checked = true;
                }
              }
            }
          });
        }
      } catch (error) {
        console.error("Error during recognition:", error);
      }
    } else {
      clearInterval(recognitionInterval);
      recognitionInterval = null;
    }
  }, 3000);
}

startFaceRecognitionBtn.addEventListener("click", (e) => {
  e.preventDefault();
  e.stopImmediatePropagation();
  videoContainer.classList.remove("hidden");
  streamFrame.src = "http://127.0.0.1:5000/stream";
  startRecognitionPolling();
});

document.getElementById("uploadForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  e.stopImmediatePropagation();
  const code = document.getElementById("studentCode").value.trim();
  const files = document.getElementById("studentImage").files;

  if (!files || files.length === 0) {
    document.getElementById("uploadResult").innerText =
      "Vui lòng chọn ít nhất một ảnh.";
    return;
  }

  const formData = new FormData();
  formData.append("student_name", code);

  for (let i = 0; i < files.length; i++) {
    formData.append("images[]", files[i]);
  }

  try {
    const res = await fetch("http://127.0.0.1:5000/api/upload", {
      method: "POST",
      headers: { "X-Requested-With": "XMLHttpRequest" },
      body: formData,
    });
    if (res.ok) {
      const data = await res.json();
      document.getElementById("uploadResult").innerText =
        data.message || "Đã gửi ảnh.";
      showSuccessNotification("Upload ảnh thành công!");
    } else {
      document.getElementById("uploadResult").innerText = "Lỗi khi gửi ảnh.";
    }
  } catch (error) {
    document.getElementById("uploadResult").innerText = "Lỗi khi gửi ảnh.";
    console.error("Error uploading image:", error);
  }
});

saveAttendanceBtn.addEventListener("click", async (e) => {
  console.log("Nút Lưu điểm danh được nhấn");
  if (isSaving) return;
  isSaving = true;
  e.preventDefault();
  e.stopImmediatePropagation();

  const attendanceData = [];
  document.querySelectorAll("#studentList tr").forEach((row) => {
    const msv = row.getAttribute("data-msv");
    const name = row.children[1].innerText;
    const checkbox = row.querySelector(".status-checkbox");
    const status = checkbox.checked ? "Present" : "Absent";
    attendanceData.push({ MSV: msv, FullName: name, Status: status });
  });

  console.group("Save Attendance Debug");
  console.log("Dữ liệu gửi lên:", {
    timetable_id: currentTimetableId,
    data: attendanceData,
  });

  try {
    const res = await fetch("http://127.0.0.1:5000/api/save_attendance", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Requested-With": "XMLHttpRequest",
      },
      body: JSON.stringify({
        timetable_id: currentTimetableId,
        data: attendanceData,
      }),
    });

    console.log("Response status:", res.status);
    console.log("Redirected:", res.redirected);
    console.log("Response headers:", res.headers.get("Location"));
    console.log("Response URL:", res.url);

    if (res.redirected) {
      console.error("API redirected to:", res.url);
      showStatusModal(false, "Lỗi: API đã redirect, kiểm tra backend!");
      console.groupEnd();
      isSaving = false;
      return;
    }

    if (res.ok) {
      const result = await res.json();
      console.log("Response data:", result);
      showStatusModal(true, result.message || "Lưu điểm danh thành công!");
    } else {
      const errorData = await res.json();
      console.log("Error response data:", errorData);
      showStatusModal(false, errorData.message || "Lỗi khi lưu điểm danh!");
    }
  } catch (error) {
    console.error("Error saving attendance:", error);
    showStatusModal(false, "Lỗi khi lưu điểm danh: " + error.message);
  }
  console.groupEnd();
  isSaving = false;
});

// Ngăn reload toàn trang
window.addEventListener("beforeunload", (e) => {
  if (isSaving) {
    console.log("Preventing reload due to ongoing save");
    e.preventDefault();
    e.returnValue = "";
  }
});

// Ngăn submit form mặc định toàn trang
document.addEventListener("submit", (e) => {
  console.log("Submit event captured on:", e.target.id);
  if (e.target.id !== "uploadForm") {
    e.preventDefault();
    e.stopImmediatePropagation();
  }
});

// Ngăn mọi hành vi navigation mặc định
document.addEventListener("click", (e) => {
  if (e.target.tagName === "A" && e.target.getAttribute("href") === "#") {
    e.preventDefault();
    e.stopImmediatePropagation();
  }
});

document.addEventListener("DOMContentLoaded", () => {
  showPage(pageUpload);
});
