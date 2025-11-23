// src/pages/PointsPage.jsx
import React, { useEffect, useMemo, useState } from "react";
import { db } from "../firebase";
import {
  collection,
  doc,
  onSnapshot,
  updateDoc,
  increment,
  setDoc,
  getDoc,
  addDoc,
  deleteDoc,
  serverTimestamp,
  getDocs,
} from "firebase/firestore";

const pointFields = ["출석", "숙제", "수업태도", "시험", "문제집완료"];

function PointsPage() {
  const [students, setStudents] = useState([]);
  const [pointsData, setPointsData] = useState({});
  const [pointLogs, setPointLogs] = useState([]);
  const [deductionModalStudent, setDeductionModalStudent] = useState(null);

  const [savepoints, setSavepoints] = useState([]);
  const [selectedSaveDate, setSelectedSaveDate] = useState("");

  // 학생 구독
  useEffect(() => {
    const ref = collection(db, "students");
    return onSnapshot(ref, (qs) => {
      const list = qs.docs.map((d) => ({ id: d.id, ...d.data() }));
      setStudents(list);
    });
  }, []);

  // 포인트 데이터 구독
  useEffect(() => {
    const ref = collection(db, "students");
    return onSnapshot(ref, (qs) => {
      const map = {};
      qs.forEach((docSnap) => {
        const data = docSnap.data();
        map[docSnap.id] = data.points || {};
      });
      setPointsData(map);
    });
  }, []);

  // point_logs 구독
  useEffect(() => {
    const ref = collection(db, "point_logs");
    return onSnapshot(ref, (qs) => {
      const list = qs.docs.map((d) => ({ id: d.id, ...d.data() }));
      setPointLogs(list);
    });
  }, []);

  // savepoint 목록
  useEffect(() => {
    (async () => {
      const snap = await getDocs(collection(db, "savepoint"));
      const list = snap.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .sort((a, b) => b.id.localeCompare(a.id));
      setSavepoints(list);
      if (list.length && !selectedSaveDate) setSelectedSaveDate(list[0].id);
    })();
  }, [selectedSaveDate]);

  const adjustPoint = async (student, field, delta) => {
    try {
      await updateDoc(doc(db, "students", student.id), {
        [`points.${field}`]: increment(delta),
        totalPoints: increment(delta),
        availablePoints: increment(delta),
      });
    } catch (e) {
      console.error("포인트 저장 실패:", e);
      alert("Firestore 저장 오류");
    }
  };

  const adjustAvailable = async (student, delta) => {
    try {
      await updateDoc(doc(db, "students", student.id), {
        availablePoints: increment(delta),
      });
    } catch (e) {
      console.error("가용포인트 저장 실패:", e);
      alert("가용포인트 저장 오류");
    }
  };

  const totalPoints = (pointsObj) => {
    return pointFields.reduce((sum, key) => sum + (pointsObj?.[key] || 0), 0);
  };

  const totalUsedForSelected = useMemo(() => {
    if (!deductionModalStudent) return 0;
    return pointLogs
      .filter((d) => d.studentId === deductionModalStudent.id)
      .reduce((sum, d) => sum + (Number(d.point) || 0), 0);
  }, [pointLogs, deductionModalStudent]);

  const handleSavePoints = async () => {
    if (!window.confirm("현재 모든 학생의 포인트 스냅샷을 저장하시겠습니까?"))
      return;

    const today = new Date().toISOString().slice(0, 10);
    const data = {};

    const logsByStudentId = pointLogs.reduce((map, log) => {
      const sid = log.studentId;
      if (!sid) return map;
      if (!map[sid]) map[sid] = [];
      map[sid].push({
        item: log.item || "",
        point: Number(log.point) || 0,
        date: log.date || (log.createdAt || "").slice(0, 10) || "",
      });
      return map;
    }, {});

    students.forEach((s) => {
      const categories = pointFields.reduce((acc, key) => {
        acc[key] = pointsData[s.id]?.[key] || 0;
        return acc;
      }, {});

      const total = Object.values(categories).reduce(
        (a, b) => a + (b || 0),
        0
      );
      const usedLogs = logsByStudentId[s.id] || [];
      const usedPoints = usedLogs.reduce(
        (sum, l) => sum + (Number(l.point) || 0),
        0
      );

      data[s.name] = {
        name: s.name,
        totalPoints: total,
        availablePoints: s.availablePoints || 0,
        usedPoints,
        usedLogs,
        categories,
      };
    });

    await setDoc(doc(db, "savepoint", today), {
      createdAt: serverTimestamp(),
      data,
    });

    alert(`✅ ${today} 기준 포인트 스냅샷이 저장되었습니다.`);
  };

  const handleResetPoints = async () => {
    if (
      !window.confirm(
        "⚠️ 모든 학생의 포인트와 사용내역을 0으로 초기화하시겠습니까? (point_logs도 모두 삭제)"
      )
    )
      return;

    for (const s of students) {
      await updateDoc(doc(db, "students", s.id), {
        points: { 출석: 0, 숙제: 0, 수업태도: 0, 시험: 0, 문제집완료: 0 },
        totalPoints: 0,
        availablePoints: 0,
      });
    }

    for (const log of pointLogs) {
      try {
        await deleteDoc(doc(db, "point_logs", log.id));
      } catch (e) {
        console.error("point_logs 삭제 오류:", e);
      }
    }

    alert("🧹 모든 포인트와 사용내역이 초기화되었습니다.");
  };

  const handleRestorePoints = async () => {
    if (!selectedSaveDate) {
      alert("복원할 저장본 날짜를 선택해 주세요.");
      return;
    }
    if (
      !window.confirm(
        `🔁 ${selectedSaveDate} 저장본으로 복원하시겠습니까?\n(현재 point_logs는 삭제되고 저장본 usedLogs로 대체됩니다)`
      )
    )
      return;

    const snap = await getDoc(doc(db, "savepoint", selectedSaveDate));
    if (!snap.exists()) {
      alert("선택한 저장본을 찾을 수 없습니다.");
      return;
    }

    const savedData = snap.data() || {};
    const data = savedData.data;
    if (!data) {
      alert("저장된 데이터가 비어 있습니다.");
      return;
    }

    // point_logs 전체 삭제
    for (const log of pointLogs) {
      try {
        await deleteDoc(doc(db, "point_logs", log.id));
      } catch (e) {
        console.error("point_logs 삭제 오류:", e);
      }
    }

    // 학생 포인트 및 로그 복원
    for (const s of students) {
      const saved = data[s.name];
      if (!saved) continue;

      const categories =
        saved.categories && typeof saved.categories === "object"
          ? saved.categories
          : {
              출석: saved.totalPoints || 0,
              숙제: 0,
              수업태도: 0,
              시험: 0,
              문제집완료: 0,
            };

      const available =
        saved.availablePoints !== undefined && saved.availablePoints !== null
          ? saved.availablePoints
          : saved.totalPoints || 0;

      await updateDoc(doc(db, "students", s.id), {
        points: categories,
        totalPoints: saved.totalPoints || 0,
        availablePoints: available,
      });

      if (Array.isArray(saved.usedLogs)) {
        for (const L of saved.usedLogs) {
          await addDoc(collection(db, "point_logs"), {
            studentId: s.id,
            name: s.name,
            item: L.item || "",
            point: Number(L.point) || 0,
            date: L.date || new Date().toISOString().slice(0, 10),
            createdAt: new Date().toISOString(),
          });
        }
      }
    }

    alert(`✅ ${selectedSaveDate} 저장본으로 복원 완료!`);
  };

  return (
    <div>
      <h2 style={{ fontSize: 18, fontWeight: "bold", marginBottom: 12 }}>
        포인트 관리
      </h2>

      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 8,
          alignItems: "center",
          marginBottom: 8,
        }}
      >
        <button
          onClick={handleSavePoints}
          style={{
            padding: "6px 10px",
            borderRadius: 4,
            border: "none",
            background: "#2563eb",
            color: "white",
            cursor: "pointer",
            fontSize: 13,
          }}
        >
          💾 저장
        </button>
        <button
          onClick={handleResetPoints}
          style={{
            padding: "6px 10px",
            borderRadius: 4,
            border: "1px solid #dc2626",
            background: "white",
            color: "#dc2626",
            cursor: "pointer",
            fontSize: 13,
          }}
        >
          ♻️ 리셋
        </button>

        <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
          <select
            value={selectedSaveDate}
            onChange={(e) => setSelectedSaveDate(e.target.value)}
            style={{
              padding: "4px 8px",
              borderRadius: 4,
              border: "1px solid #d1d5db",
              fontSize: 13,
            }}
          >
            {savepoints.map((sp) => (
              <option key={sp.id} value={sp.id}>
                {sp.id}
              </option>
            ))}
          </select>
          <button
            onClick={handleRestorePoints}
            style={{
              padding: "6px 10px",
              borderRadius: 4,
              border: "1px solid #9ca3af",
              background: "white",
              cursor: "pointer",
              fontSize: 13,
            }}
          >
            🔁 복원
          </button>
        </div>
      </div>

      <div
        style={{
          border: "1px solid #e5e7eb",
          borderRadius: 8,
          padding: 8,
          background: "white",
        }}
      >
        <div style={{ overflowX: "auto" }}>
          <table
            style={{
              width: "100%",
              borderCollapse: "collapse",
              fontSize: 13,
              minWidth: 600,
            }}
          >
            <thead>
              <tr>
                <th style={thStyle}>이름</th>
                {pointFields.map((field) => (
                  <th key={field} style={thStyle}>
                    {field}
                  </th>
                ))}
                <th style={thStyle}>가용 조정</th>
                <th style={thStyle}>총합 / 가용</th>
              </tr>
            </thead>
            <tbody>
              {[...students]
                .sort((a, b) => a.name.localeCompare(b.name, "ko-KR"))
                .map((s) => (
                  <tr key={s.id}>
                    <td style={tdStyle}>{s.name}</td>
                    {pointFields.map((field) => (
                      <td key={field} style={tdStyle}>
                        <div
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 4,
                          }}
                        >
                          <span>{pointsData[s.id]?.[field] || 0}</span>
                          <button
                            style={miniBtn}
                            onClick={() => adjustPoint(s, field, 1)}
                          >
                            +1
                          </button>
                          <button
                            style={miniDangerBtn}
                            onClick={() => adjustPoint(s, field, -1)}
                          >
                            -1
                          </button>
                        </div>
                      </td>
                    ))}
                    <td style={tdStyle}>
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 4,
                        }}
                      >
                        <button
                          style={miniBtn}
                          onClick={() => adjustAvailable(s, 1)}
                        >
                          +1
                        </button>
                        <button
                          style={miniDangerBtn}
                          onClick={() => adjustAvailable(s, -1)}
                        >
                          -1
                        </button>
                      </div>
                    </td>
                    <td style={tdStyle}>
                      <div style={{ fontSize: 12 }}>
                        총 {totalPoints(pointsData[s.id]) || 0}점
                        <br />
                        <span style={{ color: "#2563eb" }}>
                          가용 {s.availablePoints || 0}점
                        </span>
                        <br />
                        <button
                          style={{
                            marginTop: 4,
                            padding: "3px 6px",
                            borderRadius: 4,
                            border: "1px solid #9ca3af",
                            background: "white",
                            fontSize: 11,
                            cursor: "pointer",
                          }}
                          onClick={() => setDeductionModalStudent(s)}
                        >
                          차감내역
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </div>

      {deductionModalStudent && (
        <DeductionModal
          student={deductionModalStudent}
          totalUsed={totalUsedForSelected}
          logs={pointLogs}
          onClose={() => setDeductionModalStudent(null)}
        />
      )}
    </div>
  );
}

function DeductionModal({ student, totalUsed, logs, onClose }) {
  const filtered = logs
    .filter((d) => d.studentId === student.id)
    .sort((a, b) => (b.date || "").localeCompare(a.date || ""));

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.4)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 50,
      }}
    >
      <div
        style={{
          background: "white",
          borderRadius: 8,
          padding: 16,
          width: 380,
          maxHeight: "70vh",
          overflowY: "auto",
        }}
      >
        <h2 style={{ fontSize: 16, fontWeight: "bold", marginBottom: 8 }}>
          {student.name}님의 차감내역
        </h2>
        <div style={{ marginBottom: 8, fontSize: 13 }}>
          총 사용: <b>{totalUsed}</b>점
        </div>
        <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
          {filtered.length === 0 && (
            <li style={{ color: "#9ca3af", fontSize: 13 }}>
              차감 내역이 없습니다.
            </li>
          )}
          {filtered.map((d) => (
            <li
              key={d.id}
              style={{
                border: "1px solid #e5e7eb",
                borderRadius: 6,
                padding: 8,
                marginBottom: 6,
                fontSize: 13,
              }}
            >
              <div style={{ fontWeight: "bold" }}>🛍 {d.item}</div>
              <div>포인트: -{d.point}점</div>
              <div style={{ fontSize: 11, color: "#6b7280" }}>{d.date}</div>
            </li>
          ))}
        </ul>
        <div style={{ textAlign: "right", marginTop: 8 }}>
          <button
            onClick={onClose}
            style={{
              padding: "6px 10px",
              borderRadius: 4,
              border: "1px solid #9ca3af",
              background: "white",
              fontSize: 13,
              cursor: "pointer",
            }}
          >
            닫기
          </button>
        </div>
      </div>
    </div>
  );
}

const thStyle = {
  textAlign: "left",
  padding: 8,
  borderBottom: "1px solid #e5e7eb",
  background: "#f9fafb",
};
const tdStyle = {
  padding: 8,
  borderBottom: "1px solid #f3f4f6",
  verticalAlign: "top",
};
const miniBtn = {
  padding: "2px 6px",
  fontSize: 11,
  borderRadius: 4,
  border: "1px solid #d1d5db",
  background: "white",
  cursor: "pointer",
};
const miniDangerBtn = {
  ...miniBtn,
  border: "1px solid #dc2626",
  color: "#dc2626",
};

export default PointsPage;
