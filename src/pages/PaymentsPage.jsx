// src/pages/PaymentsPage.jsx
import React, { useEffect, useMemo, useState } from "react";
import { db } from "../firebase";
import {
  collection,
  doc,
  getDocs,
  onSnapshot,
  query,
  where,
  setDoc,
  serverTimestamp,
} from "firebase/firestore";

// 🔹 학생 객체에서 출생연도 추출
function getBirthYear(st) {
  const raw =
    st.birth ||
    st.birthday ||
    st.birthDay ||
    st.birthdate ||
    st.birthDate ||
    st.birthYear ||
    st.birthyear ||
    "";

  if (!raw) return null;

  if (typeof raw === "number") {
    if (raw > 1900 && raw < 2100) return raw;
  }

  const onlyDigits = String(raw).replace(/\D/g, ""); // "20130901", "130901" 등

  if (onlyDigits.length < 6) return null;

  const yStr = onlyDigits.slice(0, onlyDigits.length - 4); // 앞부분 = 연도 후보

  let yearNum = parseInt(yStr, 10);
  if (Number.isNaN(yearNum)) return null;

  if (yStr.length === 2) {
    yearNum = 2000 + yearNum; // "13" → 2013
  }

  if (yearNum < 2000 || yearNum > 2035) return null;

  return yearNum;
}

// 🔹 출생연도 기준 초/중/고 구분
function getGradeGroupFromStudent(st) {
  const year = getBirthYear(st);
  if (year) {
    if (year >= 2013 && year <= 2017) return "초등";
    if (year >= 2010 && year <= 2012) return "중등";
    if (year >= 2008 && year <= 2009) return "고등";
  }

  const label = st.gradeLabel || st.grade || st.level || "";
  if (label.startsWith("초")) return "초등";
  if (label.startsWith("중")) return "중등";
  if (label.startsWith("고")) return "고등";
  return "";
}

// 🔹 출생연도 기준 기본 수강료
function getBaseAmountFromStudent(st) {
  const year = getBirthYear(st);
  if (year) {
    if (year === 2013) return 24;
    if (year >= 2014 && year <= 2017) return 22;
    if (year >= 2010 && year <= 2012) return 36;
    if (year === 2008 || year === 2009) return 48;
  }

  const label = st.gradeLabel || st.grade || st.level || "";
  if (!label) return 0;
  if (label.startsWith("초")) {
    if (label.includes("6")) return 24;
    return 22;
  }
  if (label.startsWith("중")) return 36;
  if (label.startsWith("고")) return 48;
  return 0;
}

// 오늘 기준 연/월
function getInitialYearMonth() {
  const now = new Date();
  return {
    year: now.getFullYear(),
    month: now.getMonth() + 1,
  };
}

// YYYY-MM 문자열로 변환
function toBillingKey(year, month) {
  const mm = String(month).padStart(2, "0");
  return `${year}-${mm}`;
}

export default function PaymentsPage() {
  const { year: initialYear, month: initialMonth } = getInitialYearMonth();

  const [year, setYear] = useState(initialYear);
  const [month, setMonth] = useState(initialMonth);

  const [students, setStudents] = useState([]);
  const [payments, setPayments] = useState([]);
  const [drafts, setDrafts] = useState({});
  const [savingId, setSavingId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [gradeTab, setGradeTab] = useState("all"); // all / 초등 / 중등 / 고등
  const [statusTab, setStatusTab] = useState("all"); // all / unpaid(미결제만)
  const [searchName, setSearchName] = useState(""); // 이름 검색

  const billingKey = useMemo(() => toBillingKey(year, month), [year, month]);

  // 🔹 재원생 목록 가져오기
  useEffect(() => {
    const ref = collection(db, "students");
    const q = query(ref);

    const unsub = onSnapshot(q, (snap) => {
      const list = snap.docs.map((d) => ({
        id: d.id,
        ...d.data(),
      }));
      setStudents(list);
    });

    return () => unsub();
  }, []);

  // 🔹 선택된 월의 payments 가져오기
  useEffect(() => {
    async function fetchPayments() {
      setLoading(true);
      try {
        const ref = collection(db, "payments");
        const q = query(ref, where("billingKey", "==", billingKey));
        const snap = await getDocs(q);
        const list = snap.docs.map((d) => ({
          id: d.id,
          ...d.data(),
        }));
        setPayments(list);
      } catch (e) {
        console.error("fetchPayments error", e);
      } finally {
        setLoading(false);
      }
    }
    fetchPayments();
  }, [billingKey]);

  // 🔹 학생 + payments → drafts 초기화
  useEffect(() => {
    const map = {};

    students.forEach((st) => {
      const p = payments.find(
        (x) => x.studentId === st.id && x.billingKey === billingKey
      );

      const baseAmount = p?.baseAmount ?? getBaseAmountFromStudent(st);
      const discountAmount = p?.discountAmount ?? 0;
      const finalAmount =
        p?.finalAmount ?? (baseAmount ?? 0) - (discountAmount ?? 0);

      map[st.id] = {
        status: p?.status ?? "미결제", // "완료" / "미결제" / "부분"
        baseAmount,
        discountAmount,
        finalAmount,
        method: p?.method ?? "",
        paidAt: p?.paidAt?.substring?.(0, 10) || "",
        memo: p?.memo ?? "",
      };
    });

    setDrafts(map);
  }, [students, payments, billingKey]);

  // 🔹 저장 함수 (overrideDraft로 새 값 넘길 수 있게 수정)
  async function handleSave(st, overrideDraft) {
    const draft = overrideDraft || drafts[st.id];
    if (!draft) return;

    const docId = `${st.id}_${billingKey}`;
    const ref = doc(db, "payments", docId);

    const gradeLabel = st.gradeLabel || st.grade || st.level || "";
    const gradeGroup = getGradeGroupFromStudent(st);

    const payload = {
      studentId: st.id,
      studentName: st.name || st.studentName || "",
      gradeGroup, // 초등/중등/고등
      gradeDetail: gradeLabel,
      billingYear: year,
      billingMonth: month,
      billingKey, // "YYYY-MM"

      baseAmount: Number(draft.baseAmount) || 0,
      discountAmount: Number(draft.discountAmount) || 0,
      finalAmount: Number(draft.finalAmount) || 0,

      status: draft.status || "미결제",
      method: draft.method || "",
      paidAt: draft.paidAt || "",
      memo: draft.memo || "",

      updatedAt: serverTimestamp(),
    };

    setSavingId(st.id);
    try {
      await setDoc(ref, payload, { merge: true });
      // 자동 저장일 때는 alert 안 띄우는 게 편하면 여기 조건 넣어도 됨
      // alert(`${st.name || st.studentName || ""} ${billingKey} 결제 정보가 저장되었습니다.`);
    } catch (e) {
      console.error("save payment error", e);
      alert("저장 중 오류가 발생했습니다. 콘솔을 확인해주세요.");
    } finally {
      setSavingId(null);
    }
  }

  // 🔹 입력 변경 핸들러 (status 바뀔 때는 "새 값"으로 자동 저장)
  const updateDraft = (studentId, field, value) => {
    setDrafts((prev) => {
      const prevRow = prev[studentId] || {};
      let nextRow = { ...prevRow, [field]: value };

      if (field === "baseAmount" || field === "discountAmount") {
        const base =
          field === "baseAmount"
            ? Number(value)
            : Number(prevRow.baseAmount ?? 0);

        const discount =
          field === "discountAmount"
            ? Number(value)
            : Number(prevRow.discountAmount ?? 0);

        nextRow.finalAmount = base - discount;
      }

      const newDrafts = {
        ...prev,
        [studentId]: nextRow,
      };

      // ✅ status 변경 시, 방금 계산한 nextRow로 바로 저장
      if (field === "status") {
        const st = students.find((x) => x.id === studentId);
        if (st) {
          handleSave(st, nextRow);
        }
      }

      return newDrafts;
    });
  };

  // 🔹 연도 / 월 옵션
  const yearOptions = [];
  for (let y = initialYear - 1; y <= initialYear + 1; y++) {
    yearOptions.push(y);
  }
  const monthOptions = Array.from({ length: 12 }).map((_, i) => i + 1);

  // 🔹 화면용 메타 + 탭 필터 + 이름순 정렬
  const collator = new Intl.Collator("ko-KR");

  const studentsWithMeta = students.map((st) => {
    const name = st.name || st.studentName || "";
    const gradeLabel = st.gradeLabel || st.grade || st.level || "";
    const gradeGroup = getGradeGroupFromStudent(st);
    return {
      ...st,
      _displayName: name,
      _gradeLabel: gradeLabel,
      _gradeGroup: gradeGroup,
    };
  });

  const keyword = searchName.trim().toLowerCase();

  const filteredStudents = studentsWithMeta
    .filter((st) => {
      // 학년(초/중/고) 필터
      if (gradeTab !== "all" && st._gradeGroup !== gradeTab) return false;

      // 결제 상태 필터
      const d = drafts[st.id] || {};
      if (statusTab === "unpaid" && d.status !== "미결제") return false;

      // 이름 검색 필터
      if (keyword) {
        const nameLower = (st._displayName || "").toLowerCase();
        if (!nameLower.includes(keyword)) return false;
      }

      return true;
    })
    .sort((a, b) => collator.compare(a._displayName, b._displayName));

  // 🔹 현재 필터 기준 "완료" 건만 총 매출 합계
  const totalRevenue = filteredStudents.reduce((sum, st) => {
    const d = drafts[st.id] || {};
    if (d.status !== "완료") return sum;
    return sum + (Number(d.finalAmount) || 0);
  }, 0);

  // 🔹 엑셀(CSV) 다운로드
  const handleExportCsv = () => {
    const header = [
      "이름",
      "학년",
      "구분",
      "기본금액",
      "할인",
      "실제금액",
      "상태",
      "방법",
      "결제일",
      "메모",
    ];

    const rows = filteredStudents.map((st) => {
      const d = drafts[st.id] || {};
      const row = [
        st._displayName || "",
        st._gradeLabel || "",
        st._gradeGroup || "",
        d.baseAmount ?? "",
        d.discountAmount ?? "",
        d.finalAmount ?? "",
        d.status || "",
        d.method || "",
        d.paidAt || "",
        d.memo || "",
      ];
      return row
        .map((cell) =>
          `"${String(cell ?? "").replace(/"/g, '""')}"`
        )
        .join(",");
    });

    const csv = [header.join(","), ...rows].join("\r\n");
    const blob = new Blob([csv], {
      type: "text/csv;charset=utf-8;",
    });
    const url = URL.createObjectURL(blob);

    const a = document.createElement("a");
    a.href = url;
    a.download = `${billingKey}_결제내역.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="p-4 md:p-6">
      <h1 className="text-xl md:text-2xl font-semibold mb-4">결제 관리</h1>

      {/* 상단 필터 영역 */}
      <div className="mb-3 flex flex-wrap gap-3 items-center">
        <div className="flex items-center gap-2">
          <span className="text-sm text-gray-600">정산 연도</span>
          <select
            className="border rounded px-2 py-1 text-sm"
            value={year}
            onChange={(e) => setYear(Number(e.target.value))}
          >
            {yearOptions.map((y) => (
              <option key={y} value={y}>
                {y}년
              </option>
            ))}
          </select>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-sm text-gray-600">월</span>
          <select
            className="border rounded px-2 py-1 text-sm"
            value={month}
            onChange={(e) => setMonth(Number(e.target.value))}
          >
            {monthOptions.map((m) => (
              <option key={m} value={m}>
                {m}월
              </option>
            ))}
          </select>
        </div>

        <div className="text-sm text-gray-500">
          기준월 : <span className="font-semibold">{billingKey}</span>
        </div>

        {/* 🔍 이름 검색 */}
        <div className="flex items-center gap-2">
          <span className="text-sm text-gray-600">이름 검색</span>
          <input
            type="text"
            className="border rounded px-2 py-1 text-sm"
            placeholder="이름 일부 입력"
            value={searchName}
            onChange={(e) => setSearchName(e.target.value)}
          />
        </div>
      </div>

      {/* 🔹 상단 초/중/고 탭 */}
      <div className="mb-2 flex gap-2 flex-wrap">
        {[
          { key: "all", label: "전체" },
          { key: "초등", label: "초등" },
          { key: "중등", label: "중등" },
          { key: "고등", label: "고등" },
        ].map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => setGradeTab(tab.key)}
            className={`px-3 py-1 rounded-full text-xs md:text-sm border ${
              gradeTab === tab.key
                ? "bg-blue-500 text-white border-blue-500"
                : "bg-white text-gray-700 border-gray-300"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* 🔹 결제 상태 탭 (전체 / 미결제만) */}
      <div className="mb-4 flex gap-2 flex-wrap">
        {[
          { key: "all", label: "전체 결제" },
          { key: "unpaid", label: "미결제만" },
        ].map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => setStatusTab(tab.key)}
            className={`px-3 py-1 rounded-full text-xs md:text-sm border ${
              statusTab === tab.key
                ? "bg-red-500 text-white border-red-500"
                : "bg-white text-gray-700 border-gray-300"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* 🔹 엑셀(CSV) 다운로드 버튼 */}
      <div className="mb-3 flex justify-end">
        <button
          type="button"
          onClick={handleExportCsv}
          className="px-3 py-1 rounded text-xs md:text-sm bg-green-600 text-white hover:bg-green-700"
        >
          📁 현재 목록 엑셀(CSV) 다운로드
        </button>
      </div>

      {/* 메인 카드 */}
      <div className="bg-white shadow rounded-lg overflow-hidden">
        {loading ? (
          <div className="p-4 text-sm text-gray-500">불러오는 중...</div>
        ) : filteredStudents.length === 0 ? (
          <div className="p-4 text-sm text-gray-500">
            해당 조건의 학생이 없습니다.
          </div>
        ) : (
          <div className="overflow-auto">
            <table className="min-w-full text-xs md:text-sm border-t">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-2 py-2 border-b text-left">이름</th>
                  <th className="px-2 py-2 border-b text-left">학년</th>
                  <th className="px-2 py-2 border-b text-left">구분</th>
                  <th className="px-2 py-2 border-b text-left">상태</th>
                  <th className="px-2 py-2 border-b text-right">기본금액</th>
                  <th className="px-2 py-2 border-b text-right">할인</th>
                  <th className="px-2 py-2 border-b text-right">실제금액</th>
                  <th className="px-2 py-2 border-b text-left">방법</th>
                  <th className="px-2 py-2 border-b text-left">결제일</th>
                  <th className="px-2 py-2 border-b text-left">메모</th>
                  <th className="px-2 py-2 border-b text-center">저장</th>
                </tr>
              </thead>
              <tbody>
                {filteredStudents.map((st) => {
                  const d = drafts[st.id] || {};

                  return (
                    <tr key={st.id} className="hover:bg-gray-50">
                      <td className="px-2 py-1 border-b whitespace-nowrap">
                        {st._displayName || "-"}
                      </td>
                      <td className="px-2 py-1 border-b whitespace-nowrap">
                        {st._gradeLabel || "-"}
                      </td>
                      <td className="px-2 py-1 border-b whitespace-nowrap">
                        {st._gradeGroup || "-"}
                      </td>
                      <td className="px-2 py-1 border-b">
                        <select
                          className="border rounded px-1 py-0.5 text-xs md:text-sm"
                          value={d.status || "미결제"}
                          onChange={(e) =>
                            updateDraft(st.id, "status", e.target.value)
                          }
                        >
                          <option value="미결제">미결제</option>
                          <option value="완료">완료</option>
                          <option value="부분">부분</option>
                        </select>
                      </td>
                      <td className="px-2 py-1 border-b text-right">
                        <input
                          type="number"
                          className="border rounded px-1 py-0.5 w-20 text-right text-xs md:text-sm"
                          value={d.baseAmount ?? ""}
                          onChange={(e) =>
                            updateDraft(st.id, "baseAmount", e.target.value)
                          }
                        />
                      </td>
                      <td className="px-2 py-1 border-b text-right">
                        <input
                          type="number"
                          className="border rounded px-1 py-0.5 w-20 text-right text-xs md:text-sm"
                          value={d.discountAmount ?? 0}
                          onChange={(e) =>
                            updateDraft(
                              st.id,
                              "discountAmount",
                              e.target.value
                            )
                          }
                        />
                      </td>
                      <td className="px-2 py-1 border-b text-right">
                        <input
                          type="number"
                          className="border rounded px-1 py-0.5 w-20 text-right text-xs md:text-sm"
                          value={d.finalAmount ?? ""}
                          onChange={(e) =>
                            updateDraft(st.id, "finalAmount", e.target.value)
                          }
                        />
                      </td>
                      <td className="px-2 py-1 border-b">
                        <select
                          className="border rounded px-1 py-0.5 text-xs md:text-sm"
                          value={d.method || ""}
                          onChange={(e) =>
                            updateDraft(st.id, "method", e.target.value)
                          }
                        >
                          <option value="">선택</option>
                          <option value="계좌">계좌</option>
                          <option value="결제선생">결제선생</option>
                          <option value="카드">카드</option>
                          <option value="현금">현금</option>
                        </select>
                      </td>
                      <td className="px-2 py-1 border-b">
                        <input
                          type="date"
                          className="border rounded px-1 py-0.5 text-xs md:text-sm"
                          value={d.paidAt || ""}
                          onChange={(e) =>
                            updateDraft(st.id, "paidAt", e.target.value)
                          }
                        />
                      </td>
                      <td className="px-2 py-1 border-b">
                        <input
                          type="text"
                          className="border rounded px-1 py-0.5 w-32 md:w-40 text-xs md:text-sm"
                          value={d.memo || ""}
                          onChange={(e) =>
                            updateDraft(st.id, "memo", e.target.value)
                          }
                        />
                      </td>
                      <td className="px-2 py-1 border-b text-center">
                        <button
                          onClick={() => handleSave(st)}
                          disabled={savingId === st.id}
                          className={`px-2 py-1 rounded text-xs md:text-sm ${
                            savingId === st.id
                              ? "bg-gray-300 text-gray-600"
                              : "bg-indigo-500 text-white hover:bg-indigo-600"
                          }`}
                        >
                          {savingId === st.id ? "저장중" : "저장"}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* 🔹 총 매출 합계 (현재 필터 기준, 완료만) */}
      <div className="mt-3 text-right text-sm md:text-base text-gray-700">
        현재 목록 기준 <span className="font-semibold">완료 건</span> 총 매출 :{" "}
        <span className="font-semibold text-indigo-600">
          {totalRevenue.toLocaleString()} 만원
        </span>
      </div>

      <p className="mt-2 text-xs text-gray-400">
        ※ 각 행은 선택된 기준월(<b>{billingKey}</b>) 기준 결제 정보입니다. 저장 시
        <code className="mx-1">payments</code> 컬렉션에{" "}
        <code>studentId_billingKey</code> 형태의 문서가 기록됩니다.
      </p>
    </div>
  );
}
