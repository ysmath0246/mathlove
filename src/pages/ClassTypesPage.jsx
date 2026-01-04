// src/pages/ClassTypesPage.jsx
import React, { useEffect, useState } from "react";
import { db } from "../firebase";
import {
  collection,
  addDoc,
  updateDoc,
  doc,
  onSnapshot,
  orderBy,
  query,
} from "firebase/firestore";

function ClassTypesPage() {
  const [classTypes, setClassTypes] = useState([]);
  const [newLabel, setNewLabel] = useState("");
  const [newFee, setNewFee] = useState("");
  const [newCategory, setNewCategory] = useState("정규");
  const [newDiscountPerUse, setNewDiscountPerUse] = useState(""); // 1회당 기본 할인
  const [newMaxDiscountCount, setNewMaxDiscountCount] = useState(""); // 월 최대 할인 횟수

  useEffect(() => {
    const ref = collection(db, "class_types");
    const q = query(ref, orderBy("order", "asc"));
    return onSnapshot(q, (snap) => {
      setClassTypes(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    });
  }, []);

  const handleAdd = async () => {
    if (!newLabel.trim()) {
      alert("반 이름을 입력해주세요.");
      return;
    }
    if (!newFee.trim() || isNaN(Number(newFee))) {
      alert("기본 금액은 숫자로 입력해주세요.");
      return;
    }

    const feeNum = Number(newFee);

    // 할인 금액 / 횟수는 비워두면 0 처리
    const discountNum = newDiscountPerUse.trim()
      ? Number(newDiscountPerUse)
      : 0;
    if (isNaN(discountNum)) {
      alert("1회당 기본 할인 금액은 숫자로 입력해주세요.");
      return;
    }

    const maxCountNum = newMaxDiscountCount.trim()
      ? Number(newMaxDiscountCount)
      : 0;
    if (isNaN(maxCountNum)) {
      alert("월 최대 할인 횟수는 숫자로 입력해주세요.");
      return;
    }

    try {
      await addDoc(collection(db, "class_types"), {
        label: newLabel.trim(),
        defaultFee: feeNum,
        category: newCategory,
        order: classTypes.length + 1,
        isActive: true,
        // 🔹 새로 추가된 필드들
        discountPerUse: discountNum, // 1회당 기본 할인 금액
        maxDiscountCountPerMonth: maxCountNum, // 월 최대 할인 가능 횟수
      });
      setNewLabel("");
      setNewFee("");
      setNewCategory("정규");
      setNewDiscountPerUse("");
      setNewMaxDiscountCount("");
      alert("새 반이 추가되었습니다!");
    } catch (e) {
      console.error("반 추가 오류:", e);
      alert("반 추가 중 오류 발생.");
    }
  };

  const handleUpdate = async (id, field, value) => {
    try {
      await updateDoc(doc(db, "class_types", id), { [field]: value });
    } catch (e) {
      console.error("업데이트 오류:", e);
      alert("업데이트 중 오류 발생.");
    }
  };

  const toggleActive = async (id, prev) => {
    await handleUpdate(id, "isActive", !prev);
  };

  return (
    <div style={{ fontSize: 13 }}>
      <h2 style={{ fontSize: 18, fontWeight: "bold", marginBottom: 10 }}>
        반 설정 관리
      </h2>

      {/* --- 새 반 추가 영역 --- */}
      <div
        style={{
          border: "1px solid #e5e7eb",
          padding: 10,
          borderRadius: 8,
          marginBottom: 20,
          background: "#f9fafb",
        }}
      >
        <div style={{ fontWeight: "bold", marginBottom: 8 }}>
          ➕ 새 반 추가
        </div>

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <input
            placeholder="반 이름 (예: 초등저학년)"
            value={newLabel}
            onChange={(e) => setNewLabel(e.target.value)}
            style={inputStyle}
          />
          <input
            placeholder="기본 금액 (숫자)"
            value={newFee}
            onChange={(e) => setNewFee(e.target.value)}
            style={{ ...inputStyle, width: 100 }}
          />
          <input
            placeholder="1회당 기본 할인 (숫자)"
            value={newDiscountPerUse}
            onChange={(e) => setNewDiscountPerUse(e.target.value)}
            style={{ ...inputStyle, width: 130 }}
          />
          <input
            placeholder="월 최대 할인 횟수"
            value={newMaxDiscountCount}
            onChange={(e) => setNewMaxDiscountCount(e.target.value)}
            style={{ ...inputStyle, width: 130 }}
          />
          <select
            value={newCategory}
            onChange={(e) => setNewCategory(e.target.value)}
            style={{ ...inputStyle, width: 100 }}
          >
            <option value="정규">정규</option>
            <option value="추가">추가</option>
          </select>

          <button onClick={handleAdd} style={btnBlue}>
            반 추가
          </button>
        </div>
      </div>

      {/* --- 반 리스트 --- */}
      <div
        style={{
          border: "1px solid #e5e7eb",
          borderRadius: 8,
          padding: 10,
          background: "white",
        }}
      >
        <div style={{ fontWeight: "bold", marginBottom: 8 }}>
          📋 등록된 반 목록 ({classTypes.length}개)
        </div>

        {classTypes.length === 0 ? (
          <div style={{ fontSize: 12, color: "#9ca3af" }}>
            등록된 반이 없습니다.
          </div>
        ) : (
          <table
            style={{
              width: "100%",
              borderCollapse: "collapse",
              fontSize: 12,
            }}
          >
            <thead>
              <tr style={{ background: "#f3f4f6" }}>
                <th style={th}>순서</th>
                <th style={th}>반 이름</th>
                <th style={th}>기본 금액</th>
                <th style={th}>1회당 기본 할인</th>
                <th style={th}>월 최대 할인 횟수</th>
                <th style={th}>구분</th>
                <th style={th}>활성</th>
              </tr>
            </thead>
            <tbody>
              {classTypes.map((ct) => (
                <tr key={ct.id}>
                  {/* 순서 */}
                  <td style={td}>
                    <input
                      value={ct.order}
                      type="number"
                      style={{ width: 40, ...inputMini }}
                      onChange={(e) =>
                        handleUpdate(ct.id, "order", Number(e.target.value))
                      }
                    />
                  </td>

                  {/* 반 이름 */}
                  <td style={td}>
                    <input
                      value={ct.label}
                      onChange={(e) =>
                        handleUpdate(ct.id, "label", e.target.value)
                      }
                      style={{ ...inputMini, width: "100%" }}
                    />
                  </td>

                  {/* 기본 금액 */}
                  <td style={td}>
                    <input
                      value={ct.defaultFee ?? ""}
                      type="number"
                      onChange={(e) =>
                        handleUpdate(
                          ct.id,
                          "defaultFee",
                          e.target.value === ""
                            ? 0
                            : Number(e.target.value)
                        )
                      }
                      style={{ ...inputMini, width: 80 }}
                    />
                  </td>

                  {/* 1회당 기본 할인 금액 */}
                  <td style={td}>
                    <input
                      value={ct.discountPerUse ?? ""}
                      type="number"
                      onChange={(e) =>
                        handleUpdate(
                          ct.id,
                          "discountPerUse",
                          e.target.value === ""
                            ? 0
                            : Number(e.target.value)
                        )
                      }
                      style={{ ...inputMini, width: 90 }}
                    />
                  </td>

                  {/* 월 최대 할인 횟수 */}
                  <td style={td}>
                    <input
                      value={ct.maxDiscountCountPerMonth ?? ""}
                      type="number"
                      onChange={(e) =>
                        handleUpdate(
                          ct.id,
                          "maxDiscountCountPerMonth",
                          e.target.value === ""
                            ? 0
                            : Number(e.target.value)
                        )
                      }
                      style={{ ...inputMini, width: 90 }}
                    />
                  </td>

                  {/* 정규/추가 */}
                  <td style={td}>
                    <select
                      value={ct.category}
                      onChange={(e) =>
                        handleUpdate(ct.id, "category", e.target.value)
                      }
                      style={{ ...inputMini }}
                    >
                      <option value="정규">정규</option>
                      <option value="추가">추가</option>
                    </select>
                  </td>

                  {/* 활성 여부 */}
                  <td style={td}>
                    <button
                      onClick={() => toggleActive(ct.id, ct.isActive)}
                      style={{
                        padding: "2px 8px",
                        borderRadius: 4,
                        fontSize: 11,
                        background: ct.isActive ? "#16a34a" : "#9ca3af",
                        color: "white",
                        border: "none",
                        cursor: "pointer",
                      }}
                    >
                      {ct.isActive ? "사용중" : "숨김"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

const inputStyle = {
  padding: "4px 6px",
  fontSize: 12,
  borderRadius: 4,
  border: "1px solid #d1d5db",
};

const inputMini = {
  padding: "3px 4px",
  fontSize: 11,
  borderRadius: 4,
  border: "1px solid #d1d5db",
};

const th = {
  textAlign: "left",
  padding: 6,
  borderBottom: "1px solid #e5e7eb",
};

const td = {
  padding: 6,
  borderBottom: "1px solid #f3f4f6",
};

const btnBlue = {
  padding: "4px 10px",
  fontSize: 12,
  borderRadius: 4,
  border: "none",
  background: "#3b82f6",
  color: "white",
  cursor: "pointer",
};

export default ClassTypesPage;
