// src/pages/HolidaysPage.jsx
import React, { useEffect, useState } from "react";
import { db } from "../firebase";
import {
  collection,
  addDoc,
  deleteDoc,
  doc,
  onSnapshot,
} from "firebase/firestore";

function HolidaysPage() {
  const [holidays, setHolidays] = useState([]);
  const [holidayName, setHolidayName] = useState("");
  const [holidayDate, setHolidayDate] = useState("");

  useEffect(() => {
    const ref = collection(db, "holidays");
    return onSnapshot(ref, (qs) => {
      const hols = qs.docs.map((d) => ({
        id: d.id,
        name: d.data().name,
        date: d.data().date,
      }));
      hols.sort((a, b) => b.date.localeCompare(a.date)); // 최근 날짜 순
      setHolidays(hols);
    });
  }, []);

  const handleAddHoliday = async () => {
    if (!holidayName.trim() || !holidayDate.trim()) {
      alert("휴일 이름과 날짜를 입력해주세요.");
      return;
    }
    try {
      await addDoc(collection(db, "holidays"), {
        name: holidayName,
        date: holidayDate,
      });
      setHolidayName("");
      setHolidayDate("");
      alert("휴일이 추가되었습니다!");
    } catch (e) {
      console.error("휴일 추가 오류:", e);
      alert("추가 중 오류가 발생했습니다.");
    }
  };

  const handleDeleteHoliday = async (id) => {
    if (!window.confirm("이 휴일을 삭제하시겠습니까?")) return;
    await deleteDoc(doc(db, "holidays", id));
  };

  return (
    <div>
      <h2 style={{ fontSize: 18, fontWeight: "bold", marginBottom: 12 }}>
        휴일 관리
      </h2>

      <div
        style={{
          border: "1px solid #e5e7eb",
          borderRadius: 8,
          padding: 12,
          marginBottom: 16,
          background: "white",
        }}
      >
        <h3 style={{ fontSize: 15, fontWeight: "bold", marginBottom: 8 }}>
          휴일 추가
        </h3>
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: 8,
            alignItems: "center",
          }}
        >
          <input
            placeholder="휴일 이름 (예: 설날, 현충일)"
            value={holidayName}
            onChange={(e) => setHolidayName(e.target.value)}
            style={{
              flex: 1,
              minWidth: 180,
              padding: "6px 8px",
              borderRadius: 4,
              border: "1px solid #d1d5db",
            }}
          />
          <input
            type="date"
            value={holidayDate}
            onChange={(e) => setHolidayDate(e.target.value)}
            style={{
              width: 150,
              padding: "6px 8px",
              borderRadius: 4,
              border: "1px solid #d1d5db",
            }}
          />
          <button
            onClick={handleAddHoliday}
            style={{
              padding: "6px 10px",
              fontSize: 13,
              borderRadius: 4,
              border: "none",
              background: "#2563eb",
              color: "white",
              cursor: "pointer",
            }}
          >
            추가
          </button>
        </div>
      </div>

      <div
        style={{
          border: "1px solid #e5e7eb",
          borderRadius: 8,
          padding: 12,
          background: "white",
        }}
      >
        <h3 style={{ fontSize: 15, fontWeight: "bold", marginBottom: 8 }}>
          등록된 휴일
        </h3>
        <div style={{ overflowX: "auto" }}>
          <table
            style={{
              width: "100%",
              borderCollapse: "collapse",
              fontSize: 13,
            }}
          >
            <thead>
              <tr>
                <th style={thStyle}>이름</th>
                <th style={thStyle}>날짜</th>
                <th style={thStyle}>삭제</th>
              </tr>
            </thead>
            <tbody>
              {holidays.length === 0 && (
                <tr>
                  <td
                    colSpan={3}
                    style={{
                      padding: 8,
                      textAlign: "center",
                      color: "#9ca3af",
                    }}
                  >
                    등록된 휴일이 없습니다.
                  </td>
                </tr>
              )}
              {holidays.map((h) => (
                <tr key={h.id}>
                  <td style={tdStyle}>{h.name}</td>
                  <td style={tdStyle}>{h.date}</td>
                  <td style={tdStyle}>
                    <button
                      onClick={() => handleDeleteHoliday(h.id)}
                      style={smallDangerBtn}
                    >
                      삭제
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
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
};
const smallDangerBtn = {
  padding: "4px 8px",
  fontSize: 12,
  borderRadius: 4,
  border: "1px solid #dc2626",
  background: "white",
  color: "#dc2626",
  cursor: "pointer",
};

export default HolidaysPage;
