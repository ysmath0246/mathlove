// src/pages/MonthlyPaymentsPage.jsx
import React, { useEffect, useMemo, useState } from "react";
import { db } from "../firebase";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  where,
  setDoc,
  serverTimestamp,
} from "firebase/firestore";


const TARGET_YEAR = 2026; // 학년 계산 기준 연도

// --------------------
// 날짜 관련 helpers
// --------------------
function monthStringToDate(m) {
  const [y, mm] = m.split("-").map(Number);
  return new Date(y, mm - 1, 1);
}

function dateToMonthString(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function moveMonth(current, offset) {
  const d = monthStringToDate(current);
  const next = new Date(d.getFullYear(), d.getMonth() + offset, 1);
  return dateToMonthString(next);
}


function getCurrentMonthString() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}


// --------------------
// 학년/학교급 계산
// --------------------
function getSchoolInfo(st) {
  const raw =
    st.birth ||
    st.studentBirth ||
    st.birthday ||
    st.birthdate ||
    st.birthDate ||
    "";

  const match = String(raw).match(/(\d{4})/);
  if (!match) return { level: "unknown", gradeLabel: "" };

  const birthYear = parseInt(match[1], 10);
  const gradeNum = TARGET_YEAR - birthYear - 6; // 대략 1~12

  if (gradeNum < 1 || gradeNum > 12)
    return { level: "unknown", gradeLabel: "" };

  if (gradeNum <= 6)
    return { level: "elementary", gradeLabel: `초${gradeNum}` };
  if (gradeNum <= 9)
    return { level: "middle", gradeLabel: `중${gradeNum - 6}` };
  return { level: "high", gradeLabel: `고${gradeNum - 9}` };
}

// --------------------
// class_types 불러오기
// --------------------
async function fetchClassTypes() {
  const snap = await getDocs(collection(db, "class_types"));
  return snap.docs
    .filter((d) => d.data().isActive !== false)
    .map((d) => ({ id: d.id, ...d.data() }))
    .sort((a, b) => {
      const ao = a.order ?? 999;
      const bo = b.order ?? 999;
      return ao - bo;
    });
}

// 해당 학생이 가진 classTypes 배열을 기반으로
// 기본금액 + 할인 설정 맵 만들기
function buildFeeAndDiscountConfigForStudent(studentClassTypes, classTypes) {
  const baseMap = {};
  const perUseMap = {};
  const maxCountMap = {};

  studentClassTypes.forEach((label) => {
    const found = classTypes.find((ct) => ct.label === label);
    if (found) {
      baseMap[label] = Number(found.defaultFee || 0);
      perUseMap[label] = Number(found.discountPerUse || 0);
      // 설정이 없으면 기본 2회로 둘 수도 있음 (원장님 룰에 맞게 조정 가능)
      const rawMax = found.maxDiscountCountPerMonth;
      maxCountMap[label] =
        rawMax === undefined || rawMax === null
          ? 2
          : Number(rawMax) || 0;
    }
  });

  return { baseMap, perUseMap, maxCountMap };
}

// 할인 로그/설정을 기준으로 할인금액/최종금액 재계산
function recalcPartialAmountsFromLogs(partial) {
  const base = Number(partial.baseAmount) || 0;
  const perUse = Number(partial.discountPerUse) || 0;

  const maxCountRaw = partial.maxDiscountCountPerMonth;
  const maxCount =
    maxCountRaw === undefined || maxCountRaw === null
      ? null
      : Number(maxCountRaw);

  const logsArray = Array.isArray(partial.discountLogs)
    ? partial.discountLogs
    : [];

  const rawCount = logsArray.length;

  const effectiveCount =
    maxCount !== null && !Number.isNaN(maxCount)
      ? Math.min(rawCount, maxCount)
      : rawCount;

  const discountAmount = perUse * effectiveCount;
  const finalAmount = Math.max(base - discountAmount, 0);

  return {
    ...partial,
    discountLogs: logsArray,
    discountCount: effectiveCount,
    discountAmount,
    finalAmount,
  };
}

// summary를 partials 기준으로 다시 계산
function recalcSummaryFromPartials(partials, prevSummary) {
  const baseTotal = partials.reduce(
    (sum, p) => sum + (Number(p.baseAmount) || 0),
    0
  );
  const discountTotal = partials.reduce(
    (sum, p) => sum + (Number(p.discountAmount) || 0),
    0
  );
  const finalTotal = partials.reduce(
    (sum, p) => sum + (Number(p.finalAmount) || 0),
    0
  );

  const hasPartials = partials.length > 0;
  const allPaid = hasPartials && partials.every((p) => p.status === "paid");
  const anyPaid = partials.some((p) => p.status === "paid");

  let status = prevSummary?.status || "pending";
  if (allPaid) status = "paid";
  else if (anyPaid) status = "partial";
  else if (!anyPaid) status = "pending";

  return {
    baseTotal,
    discountTotal,
    finalTotal,
    status,
    memo: prevSummary?.memo || "",
  };
}

// 월 + 학생 목록 + class_types 를 기반으로 monthly_payments 문서들 로딩
async function loadMonthlyRecords(month, students, classTypes) {
  const results = [];

  for (const st of students) {
    const sid = st.id;
    const docId = `${month}_${sid}`;
    const ref = doc(db, "monthly_payments", docId);
    const snap = await getDoc(ref);

    const studentName =
      st.name || st.studentName || st.displayName || "(이름 없음)";
    const { level, gradeLabel } = getSchoolInfo(st);

    const studentClasses = Array.isArray(st.classTypes)
      ? st.classTypes
      : [];

    const { baseMap, perUseMap, maxCountMap } =
      buildFeeAndDiscountConfigForStudent(studentClasses, classTypes);

    if (!snap.exists()) {
      // 새 문서: partials/summary 기본값 생성
      const partials = studentClasses.map((cls) => {
        const base = baseMap[cls] || 0;
        const discountPerUse = perUseMap[cls] ?? 0;
        const maxCount = maxCountMap[cls] ?? 2;

        const basePartial = {
          classType: cls,
          baseAmount: base,
          discountPerUse,
          maxDiscountCountPerMonth: maxCount,
          discountLogs: [],
          discountCount: 0,
          discountAmount: 0,
          finalAmount: base,
          status: "pending", // pending | paid | late | exempt
          paymentMethod: "none", // none | bank | card | teacher
          paidDate: "",
          memo: "",
        };

        return recalcPartialAmountsFromLogs(basePartial);
      });

      const summary = recalcSummaryFromPartials(partials, {
        status: "pending",
        memo: "",
      });

      results.push({
        id: docId,
        exists: false,
        month,
        studentId: sid,
        studentName,
        level,
        grade: gradeLabel,
        classTypes: studentClasses,
        partials,
        summary,
      });
    } else {
      const data = snap.data();
      let partials = Array.isArray(data.partials) ? data.partials : [];

      // 학생 classTypes 기준으로 partials 정리: 현재 반만 남기고, 없던 반은 새로 추가
      partials = partials
        .filter((p) => studentClasses.includes(p.classType))
        .map((p) => {
          const cls = p.classType;
          const base = Number(p.baseAmount) || baseMap[cls] || 0;

          const discountPerUse =
            p.discountPerUse !== undefined
              ? Number(p.discountPerUse) || 0
              : perUseMap[cls] ?? 0;

          const maxRaw =
            p.maxDiscountCountPerMonth !== undefined
              ? p.maxDiscountCountPerMonth
              : maxCountMap[cls] ?? 2;
          const maxCount =
            maxRaw === undefined || maxRaw === null
              ? null
              : Number(maxRaw);

          const logs = Array.isArray(p.discountLogs)
            ? p.discountLogs
            : [];

          const hasLogs = logs.length > 0;

          let out = {
            ...p,
            baseAmount: base,
            discountPerUse,
            maxDiscountCountPerMonth: maxCount,
            discountLogs: logs,
          };

          // 기존 데이터에 로그가 없다면, 이전 discountAmount/finalAmount는 유지
          if (hasLogs) {
            out = recalcPartialAmountsFromLogs(out);
          } else {
            out.discountCount = Number(p.discountCount) || 0;
            out.discountAmount = Number(p.discountAmount) || 0;
            out.finalAmount =
              p.finalAmount !== undefined
                ? Number(p.finalAmount) || 0
                : Math.max(
                    base - (Number(out.discountAmount) || 0),
                    0
                  );
          }

          return out;
        });

      // 학생 classTypes 안에 있는데 partials에 없는 반은 새로 추가
      studentClasses.forEach((cls) => {
        if (!partials.find((p) => p.classType === cls)) {
          const base = baseMap[cls] || 0;
          const discountPerUse = perUseMap[cls] ?? 0;
          const maxCount = maxCountMap[cls] ?? 2;

          const basePartial = {
            classType: cls,
            baseAmount: base,
            discountPerUse,
            maxDiscountCountPerMonth: maxCount,
            discountLogs: [],
            discountCount: 0,
            discountAmount: 0,
            finalAmount: base,
            status: "pending",
            paymentMethod: "none",
            paidDate: "",
            memo: "",
          };

          partials.push(recalcPartialAmountsFromLogs(basePartial));
        }
      });

      const summary = recalcSummaryFromPartials(partials, data.summary);

      results.push({
        id: docId,
        exists: true,
        month,
        studentId: sid,
        studentName,
        level,
        grade: gradeLabel,
        classTypes: studentClasses,
        partials,
        summary,
      });
    }
  }

  // 이름순 정렬
  results.sort((a, b) => a.studentName.localeCompare(b.studentName, "ko"));
  return results;
}

// --------------------
// 메인 컴포넌트
// --------------------
export default function MonthlyPaymentsPage() {
 const [month, setMonth] = useState(getCurrentMonthString());

  const [students, setStudents] = useState([]);
  const [classTypes, setClassTypes] = useState([]);
  const [records, setRecords] = useState([]);
  const [loadingBase, setLoadingBase] = useState(true);
  const [loadingMonth, setLoadingMonth] = useState(true);
  const [savingId, setSavingId] = useState(null);

  const [viewMode, setViewMode] = useState("summary"); // summary | byClass
  const [classFilter, setClassFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [showUnpaidOnly, setShowUnpaidOnly] = useState(false);

  // 할인 로그 편집 모달 상태
  const [logEditor, setLogEditor] = useState(null);
  // { recordId, classType, newDate, newReason, newNote }

  // ===== 1. 학생 + class_types 불러오기 =====
  useEffect(() => {
    (async () => {
      setLoadingBase(true);
      try {
        const studentsSnap = await getDocs(
          query(collection(db, "students"))
        );
        const studentsList = studentsSnap.docs.map((d) => ({
          id: d.id,
          ...d.data(),
        }));
        studentsList.sort((a, b) =>
          (a.name || a.studentName || "").localeCompare(
            b.name || b.studentName || "",
            "ko"
          )
        );
        setStudents(studentsList);

        const ctList = await fetchClassTypes();
        setClassTypes(ctList);
      } catch (e) {
        console.error("기본 데이터 로딩 오류:", e);
        alert("학생 / 반 정보 로딩 중 오류가 발생했습니다.");
      } finally {
        setLoadingBase(false);
      }
    })();
  }, []);

  // ===== 2. month, students, classTypes 기반으로 monthly_payments 로딩 =====
  useEffect(() => {
    if (loadingBase) return;
    if (students.length === 0) {
      setRecords([]);
      setLoadingMonth(false);
      return;
    }

    (async () => {
      setLoadingMonth(true);
      try {
        const list = await loadMonthlyRecords(
          month,
          students,
          classTypes
        );
        setRecords(list);
      } catch (e) {
        console.error("월별 결제 데이터 로딩 오류:", e);
        alert("월별 결제 데이터를 불러오는 중 오류가 발생했습니다.");
      } finally {
        setLoadingMonth(false);
      }
    })();
  }, [month, students, classTypes, loadingBase]);

  const isLoading = loadingBase || loadingMonth;

  // ===== 3. 상태 업데이트 helpers =====

  // 특정 학생-반(partial) 업데이트
  const updatePartial = (recordId, classType, patch) => {
    setRecords((prev) =>
      prev.map((rec) => {
        if (rec.id !== recordId) return rec;

        const newPartials = rec.partials.map((p) => {
          if (p.classType !== classType) return p;
          const merged = { ...p, ...patch };

          // baseAmount / 할인설정 / 로그 변경 시 자동 재계산
          if (
            Object.prototype.hasOwnProperty.call(patch, "baseAmount") ||
            Object.prototype.hasOwnProperty.call(
              patch,
              "discountPerUse"
            ) ||
            Object.prototype.hasOwnProperty.call(
              patch,
              "maxDiscountCountPerMonth"
            ) ||
            Object.prototype.hasOwnProperty.call(
              patch,
              "discountLogs"
            )
          ) {
            return recalcPartialAmountsFromLogs(merged);
          }

          // 그 외 필드는 그대로 반영 (finalAmount 직접 수정 등)
          return merged;
        });

        const newSummary = recalcSummaryFromPartials(
          newPartials,
          rec.summary
        );

        return {
          ...rec,
          partials: newPartials,
          summary: newSummary,
        };
      })
    );
  };

  // 종합(summary) 상태/메모 변경
  const updateSummary = (recordId, patch) => {
    setRecords((prev) =>
      prev.map((rec) => {
        if (rec.id !== recordId) return rec;

        let partials = rec.partials.map((p) => ({ ...p }));
        let summary = { ...rec.summary, ...patch };

        // 종합 상태를 'paid'로 변경하면 모든 partial도 paid 로
        if (patch.status === "paid") {
          partials = partials.map((p) => ({ ...p, status: "paid" }));
        }

        summary = recalcSummaryFromPartials(partials, summary);

        return {
          ...rec,
          partials,
          summary,
        };
      })
    );
  };

  // Firestore 저장
  const saveRecord = async (recordId) => {
    const rec = records.find((r) => r.id === recordId);
    if (!rec) return;

    const ref = doc(db, "monthly_payments", rec.id);
    const summary = recalcSummaryFromPartials(
      rec.partials,
      rec.summary
    );

    const payload = {
      month: rec.month,
      studentId: rec.studentId,
      studentName: rec.studentName,
      level: rec.level,
      grade: rec.grade,
      classTypes: rec.classTypes,
      partials: rec.partials.map((p) => ({
        classType: p.classType,
        baseAmount: Number(p.baseAmount) || 0,
        discountAmount: Number(p.discountAmount) || 0,
        finalAmount: Number(p.finalAmount) || 0,
        status: p.status || "pending",
        paymentMethod: p.paymentMethod || "none",
        paidDate: p.paidDate || "",
        memo: p.memo || "",
        discountPerUse: Number(p.discountPerUse) || 0,
        maxDiscountCountPerMonth:
          p.maxDiscountCountPerMonth === undefined ||
          p.maxDiscountCountPerMonth === null
            ? null
            : Number(p.maxDiscountCountPerMonth) || 0,
        discountCount: Number(p.discountCount) || 0,
        discountLogs: Array.isArray(p.discountLogs)
          ? p.discountLogs
          : [],
      })),
      summary: {
        baseTotal: summary.baseTotal,
        discountTotal: summary.discountTotal,
        finalTotal: summary.finalTotal,
        status: summary.status,
        memo: summary.memo || "",
      },
      updatedAt: serverTimestamp(),
    };

    if (!rec.exists) {
      payload.createdAt = serverTimestamp();
    }

    try {
      setSavingId(rec.id);
      await setDoc(ref, payload, { merge: true });
      setRecords((prev) =>
        prev.map((r) =>
          r.id === rec.id ? { ...r, exists: true, summary } : r
        )
      );
    } catch (e) {
      console.error("월제 결제 저장 오류:", e);
      alert("저장 중 오류가 발생했습니다.");
    } finally {
      setSavingId(null);
    }
  };

  // ===== 4. 필터링 / 뷰용 데이터 만들기 =====
  const monthLabel = useMemo(() => {
    const d = monthStringToDate(month);
    return `${d.getFullYear()}년 ${d.getMonth() + 1}월`;
  }, [month]);

  const searchLower = search.trim().toLowerCase();

  // (1) summary 모드에서 사용할 레코드
  const summaryRows = useMemo(() => {
    let list = records;

    if (searchLower) {
      list = list.filter((r) =>
        r.studentName.toLowerCase().includes(searchLower)
      );
    }

    if (showUnpaidOnly) {
      list = list.filter((r) => r.summary.status !== "paid");
    }

    return list;
  }, [records, searchLower, showUnpaidOnly]);

  // (2) byClass 모드에서 사용할 플랫 리스트
  const classRows = useMemo(() => {
    let flat = [];
    records.forEach((rec) => {
      rec.partials.forEach((p) => {
        flat.push({
          recordId: rec.id,
          studentName: rec.studentName,
          grade: rec.grade,
          level: rec.level,
          month: rec.month,
          classType: p.classType,
          baseAmount: p.baseAmount,
          discountAmount: p.discountAmount,
          finalAmount: p.finalAmount,
          status: p.status,
          paymentMethod: p.paymentMethod,
          paidDate: p.paidDate,
          memo: p.memo,
          exists: rec.exists,
          discountPerUse: p.discountPerUse || 0,
          maxDiscountCountPerMonth: p.maxDiscountCountPerMonth,
          discountCount:
            p.discountCount ||
            (Array.isArray(p.discountLogs)
              ? p.discountLogs.length
              : 0),
          discountLogs: Array.isArray(p.discountLogs)
            ? p.discountLogs
            : [],
        });
      });
    });

    if (classFilter !== "all") {
      flat = flat.filter((r) => r.classType === classFilter);
    }

    if (searchLower) {
      flat = flat.filter((r) =>
        r.studentName.toLowerCase().includes(searchLower)
      );
    }

    if (showUnpaidOnly) {
      flat = flat.filter((r) => r.status !== "paid");
    }

    flat.sort((a, b) => {
      const n = a.studentName.localeCompare(b.studentName, "ko");
      if (n !== 0) return n;
      return a.classType.localeCompare(b.classType, "ko");
    });

    return flat;
  }, [records, classFilter, searchLower, showUnpaidOnly]);

  // 현재 뷰 기준 요약 합계
  const summaryTotals = useMemo(() => {
    if (viewMode === "summary") {
      return summaryRows.reduce(
        (acc, r) => ({
          base: acc.base + (Number(r.summary.baseTotal) || 0),
          discount:
            acc.discount + (Number(r.summary.discountTotal) || 0),
          final: acc.final + (Number(r.summary.finalTotal) || 0),
          paidCount:
            acc.paidCount + (r.summary.status === "paid" ? 1 : 0),
          count: acc.count + 1,
        }),
        { base: 0, discount: 0, final: 0, paidCount: 0, count: 0 }
      );
    }

    // byClass 모드
    return classRows.reduce(
      (acc, r) => ({
        base: acc.base + (Number(r.baseAmount) || 0),
        discount:
          acc.discount + (Number(r.discountAmount) || 0),
        final: acc.final + (Number(r.finalAmount) || 0),
        paidCount: acc.paidCount + (r.status === "paid" ? 1 : 0),
        count: acc.count + 1,
      }),
      { base: 0, discount: 0, final: 0, paidCount: 0, count: 0 }
    );
  }, [viewMode, summaryRows, classRows]);

  // 현재 모달에서 보고 있는 할인로그 대상
  const currentLogData = useMemo(() => {
    if (!logEditor) return null;
    const rec = records.find((r) => r.id === logEditor.recordId);
    if (!rec) return null;
    const partial = rec.partials.find(
      (p) => p.classType === logEditor.classType
    );
    if (!partial) return null;
    return { rec, partial };
  }, [logEditor, records]);

  // 할인 로그 추가
  const handleAddDiscountLog = () => {
    if (!logEditor || !currentLogData) return;
    const { rec, partial } = currentLogData;

    if (!logEditor.newDate) {
      alert("할인 적용 날짜를 선택해주세요.");
      return;
    }

    const logs = Array.isArray(partial.discountLogs)
      ? partial.discountLogs
      : [];

    const amount = Number(partial.discountPerUse) || 0;

    const newLogs = [
      ...logs,
      {
        date: logEditor.newDate,
        reasonCategory: logEditor.newReason || "기타",
        note: logEditor.newNote || "",
        amount,
      },
    ];

    updatePartial(rec.id, partial.classType, {
      discountLogs: newLogs,
    });

    setLogEditor((prev) =>
      prev
        ? {
            ...prev,
            newDate: "",
            newReason: prev.newReason,
            newNote: "",
          }
        : null
    );
  };

  // 할인 로그 삭제
  const handleDeleteDiscountLog = (idx) => {
    if (!logEditor || !currentLogData) return;
    const { rec, partial } = currentLogData;

    const logs = Array.isArray(partial.discountLogs)
      ? partial.discountLogs
      : [];
    const newLogs = logs.filter((_, i) => i !== idx);

    updatePartial(rec.id, partial.classType, {
      discountLogs: newLogs,
    });
  };

  // --------------------
  // 렌더링
  // --------------------
  return (
    <div>
      <h2 style={{ fontSize: 18, fontWeight: "bold", marginBottom: 10 }}>
        월제 결제 관리
      </h2>

      {/* 뷰 모드 탭 */}
      <div
        style={{
          display: "flex",
          gap: 8,
          marginBottom: 8,
          flexWrap: "wrap",
        }}
      >
        {[
          { key: "summary", label: "이름순 (종합)" },
          { key: "byClass", label: "반별 (부분금액)" },
        ].map((t) => {
          const active = viewMode === t.key;
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => setViewMode(t.key)}
              style={{
                padding: "6px 12px",
                borderRadius: 999,
                border: active ? "1px solid #2563eb" : "1px solid #d1d5db",
                background: active ? "#2563eb" : "#ffffff",
                color: active ? "#ffffff" : "#111827",
                fontSize: 13,
                cursor: "pointer",
              }}
            >
              {t.label}
            </button>
          );
        })}

        {/* byClass 모드일 때 반 선택 */}
        {viewMode === "byClass" && (
          <select
            value={classFilter}
            onChange={(e) => setClassFilter(e.target.value)}
            style={{
              padding: "4px 8px",
              borderRadius: 6,
              border: "1px solid #d1d5db",
              fontSize: 12,
            }}
          >
            <option value="all">전체 반</option>
            {classTypes.map((ct) => (
              <option key={ct.id} value={ct.label}>
                {ct.label}
              </option>
            ))}
          </select>
        )}

        {/* 검색 */}
        <input
          type="text"
          placeholder="학생 이름 검색"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{
            padding: "4px 8px",
            borderRadius: 6,
            border: "1px solid #d1d5db",
            fontSize: 12,
            minWidth: 140,
          }}
        />

        {/* 미납만 */}
        <label
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 4,
            fontSize: 12,
          }}
        >
          <input
            type="checkbox"
            checked={showUnpaidOnly}
            onChange={(e) => setShowUnpaidOnly(e.target.checked)}
          />
          미결제만 보기
        </label>
      </div>

      {/* 월 이동 + 요약 */}
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 12,
          alignItems: "center",
          marginBottom: 10,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <button
            type="button"
            onClick={() => setMonth((m) => moveMonth(m, -1))}
            style={navBtnStyle}
          >
            ◀
          </button>
          <div style={{ fontSize: 16, fontWeight: 600 }}>{monthLabel}</div>
          <button
            type="button"
            onClick={() => setMonth((m) => moveMonth(m, 1))}
            style={navBtnStyle}
          >
            ▶
          </button>
        </div>

        <div
          style={{
            padding: "6px 10px",
            borderRadius: 6,
            background: "#f9fafb",
            border: "1px solid #e5e7eb",
            fontSize: 12,
            display: "flex",
            flexWrap: "wrap",
            gap: 10,
          }}
        >
          <span>
            항목 수: <b>{summaryTotals.count}</b>
          </span>
          <span>
            결제완료: <b>{summaryTotals.paidCount}</b>
          </span>
          <span>
            기본 합계:{" "}
            <b>{summaryTotals.base.toLocaleString("ko-KR")}원</b>
          </span>
          <span>
            할인 합계:{" "}
            <b>{summaryTotals.discount.toLocaleString("ko-KR")}원</b>
          </span>
          <span>
            최종 합계:{" "}
            <b>{summaryTotals.final.toLocaleString("ko-KR")}원</b>
          </span>
        </div>
      </div>

      {isLoading && (
        <p style={{ fontSize: 13, color: "#6b7280" }}>
          데이터를 불러오는 중입니다...
        </p>
      )}

      {!isLoading && viewMode === "summary" && summaryRows.length === 0 && (
        <p style={{ fontSize: 13, color: "#6b7280" }}>
          표시할 학생이 없습니다.
        </p>
      )}

      {!isLoading && viewMode === "byClass" && classRows.length === 0 && (
        <p style={{ fontSize: 13, color: "#6b7280" }}>
          표시할 반별 항목이 없습니다.
        </p>
      )}

      {/* ====================
          1) 이름순(종합) 뷰
          ==================== */}
      {!isLoading && viewMode === "summary" && summaryRows.length > 0 && (
        <div
          style={{
            border: "1px solid #e5e7eb",
            borderRadius: 8,
            background: "#ffffff",
          }}
        >
          <div style={{ overflowX: "auto" }}>
            <table
              style={{
                width: "100%",
                borderCollapse: "collapse",
                fontSize: 12,
              }}
            >
              <thead>
                <tr>
                  <th style={thStyle}>이름</th>
                  <th style={thStyle}>학년</th>
                  <th style={thStyle}>반 목록</th>
                  <th style={thStyle}>기본 합계</th>
                  <th style={thStyle}>할인 합계</th>
                  <th style={thStyle}>최종 합계</th>
                  <th style={thStyle}>종합 상태</th>
                  <th style={thStyle}>종합 메모</th>
                  <th style={thStyle}>저장</th>
                </tr>
              </thead>
              <tbody>
                {summaryRows.map((r) => (
                  <tr key={r.id}>
                    <td style={tdStyle}>{r.studentName}</td>
                    <td style={tdStyle}>{r.grade}</td>
                    <td style={{ ...tdStyle, minWidth: 160 }}>
                      {r.classTypes && r.classTypes.length > 0
                        ? r.classTypes.join(", ")
                        : "-"}
                    </td>
                    <td style={tdStyleNumber}>
                      {r.summary.baseTotal.toLocaleString("ko-KR")}
                    </td>
                    <td style={tdStyleNumber}>
                      {r.summary.discountTotal.toLocaleString("ko-KR")}
                    </td>
                    <td style={tdStyleNumber}>
                      {r.summary.finalTotal.toLocaleString("ko-KR")}
                    </td>
                    <td style={tdStyleCenter}>
                      <select
                        value={r.summary.status}
                        onChange={(e) =>
                          updateSummary(r.id, { status: e.target.value })
                        }
                        style={selectStyle}
                      >
                        <option value="pending">미납</option>
                        <option value="partial">부분완료</option>
                        <option value="paid">완료</option>
                      </select>
                    </td>
                    <td style={{ ...tdStyle, minWidth: 160 }}>
                      <input
                        type="text"
                        value={r.summary.memo || ""}
                        onChange={(e) =>
                          updateSummary(r.id, { memo: e.target.value })
                        }
                        style={textInputStyle}
                        placeholder="종합 메모"
                      />
                    </td>
                    <td style={tdStyleCenter}>
                      <button
                        type="button"
                        onClick={() => saveRecord(r.id)}
                        disabled={savingId === r.id}
                        style={saveBtnStyle}
                      >
                        {savingId === r.id ? "저장중..." : "저장"}
                      </button>
                      {!r.exists && (
                        <div
                          style={{
                            fontSize: 10,
                            color: "#6b7280",
                            marginTop: 2,
                          }}
                        >
                          새 문서
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ====================
          2) 반별(부분금액) 뷰
          ==================== */}
      {!isLoading && viewMode === "byClass" && classRows.length > 0 && (
        <div
          style={{
            border: "1px solid #e5e7eb",
            borderRadius: 8,
            background: "#ffffff",
          }}
        >
          <div style={{ overflowX: "auto" }}>
            <table
              style={{
                width: "100%",
                borderCollapse: "collapse",
                fontSize: 12,
              }}
            >
              <thead>
                <tr>
                  <th style={thStyle}>반</th>
                  <th style={thStyle}>이름</th>
                  <th style={thStyle}>학년</th>
                  <th style={thStyle}>기본금액</th>
                  <th style={thStyle}>할인금액</th>
                  <th style={thStyle}>할인내역</th>
                  <th style={thStyle}>최종금액</th>
                  <th style={thStyle}>상태</th>
                  <th style={thStyle}>결제수단</th>
                  <th style={thStyle}>납부일</th>
                  <th style={thStyle}>메모</th>
                  <th style={thStyle}>저장</th>
                </tr>
              </thead>
              <tbody>
                {classRows.map((row, idx) => (
                  <tr key={`${row.recordId}_${row.classType}_${idx}`}>
                    <td style={tdStyle}>{row.classType}</td>
                    <td style={tdStyle}>{row.studentName}</td>
                    <td style={tdStyle}>{row.grade}</td>
                    <td style={tdStyleNumber}>
                      <input
                        type="number"
                        value={row.baseAmount}
                        onChange={(e) =>
                          updatePartial(row.recordId, row.classType, {
                            baseAmount: Number(e.target.value) || 0,
                          })
                        }
                        style={numInputStyle}
                      />
                    </td>
                    {/* 할인금액: 자동 계산 표시 */}
                    <td style={tdStyleNumber}>
                      <div>
                        {Number(row.discountAmount || 0).toLocaleString(
                          "ko-KR"
                        )}
                        원
                      </div>
                      <div
                        style={{
                          fontSize: 10,
                          color: "#6b7280",
                          marginTop: 2,
                        }}
                      >
                        {row.discountCount || 0}회
                        {row.maxDiscountCountPerMonth
                          ? ` / 최대 ${row.maxDiscountCountPerMonth}회`
                          : ""}
                      </div>
                    </td>
                    {/* 할인내역 버튼 */}
                    <td style={tdStyleCenter}>
                      <button
                        type="button"
                        onClick={() =>
                          setLogEditor({
                            recordId: row.recordId,
                            classType: row.classType,
                            newDate: "",
                            newReason: "질병결석",
                            newNote: "",
                          })
                        }
                        style={{
                          padding: "3px 8px",
                          borderRadius: 4,
                          border: "1px solid #d1d5db",
                          background: "#ffffff",
                          fontSize: 11,
                          cursor: "pointer",
                        }}
                      >
                        내역 ({row.discountLogs.length})
                      </button>
                    </td>
                    {/* 최종금액: 필요하면 수동 수정 가능 */}
                    <td style={tdStyleNumber}>
                      <input
                        type="number"
                        value={row.finalAmount}
                        onChange={(e) =>
                          updatePartial(row.recordId, row.classType, {
                            finalAmount: Number(e.target.value) || 0,
                          })
                        }
                        style={{ ...numInputStyle, fontWeight: 600 }}
                      />
                    </td>
                    <td style={tdStyleCenter}>
                      <select
                        value={row.status}
                        onChange={(e) =>
                          updatePartial(row.recordId, row.classType, {
                            status: e.target.value,
                          })
                        }
                        style={selectStyle}
                      >
                        <option value="pending">미납</option>
                        <option value="paid">결제완료</option>
                        <option value="late">지각납부</option>
                        <option value="exempt">면제/기타</option>
                      </select>
                    </td>
                    <td style={tdStyleCenter}>
                      <select
                        value={row.paymentMethod}
                        onChange={(e) =>
                          updatePartial(row.recordId, row.classType, {
                            paymentMethod: e.target.value,
                          })
                        }
                        style={selectStyle}
                      >
                        <option value="none">-</option>
                        <option value="bank">계좌이체</option>
                        <option value="card">카드</option>
                        <option value="teacher">결제선생</option>
                      </select>
                    </td>
                    <td style={tdStyleCenter}>
                      <input
                        type="date"
                        value={row.paidDate || ""}
                        onChange={(e) =>
                          updatePartial(row.recordId, row.classType, {
                            paidDate: e.target.value,
                          })
                        }
                        style={dateInputStyle}
                      />
                    </td>
                    <td style={{ ...tdStyle, minWidth: 160 }}>
                      <input
                        type="text"
                        value={row.memo || ""}
                        onChange={(e) =>
                          updatePartial(row.recordId, row.classType, {
                            memo: e.target.value,
                          })
                        }
                        style={textInputStyle}
                        placeholder="반별 메모"
                      />
                    </td>
                    <td style={tdStyleCenter}>
                      <button
                        type="button"
                        onClick={() => saveRecord(row.recordId)}
                        disabled={savingId === row.recordId}
                        style={saveBtnStyle}
                      >
                        {savingId === row.recordId ? "저장중..." : "저장"}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* 할인내역 모달 */}
      {logEditor && currentLogData && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.35)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 50,
          }}
          onClick={() => setLogEditor(null)}
        >
          <div
            style={{
              width: "100%",
              maxWidth: 520,
              background: "#ffffff",
              borderRadius: 8,
              padding: 12,
              boxShadow:
                "0 10px 25px rgba(15,23,42,0.18), 0 4px 6px rgba(15,23,42,0.08)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: 8,
              }}
            >
              <div>
                <div
                  style={{ fontSize: 14, fontWeight: "bold", marginBottom: 2 }}
                >
                  할인 내역 관리
                </div>
                <div style={{ fontSize: 12, color: "#6b7280" }}>
                  {currentLogData.rec.studentName} /{" "}
                  {currentLogData.partial.classType}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setLogEditor(null)}
                style={{
                  border: "none",
                  background: "transparent",
                  cursor: "pointer",
                  fontSize: 16,
                }}
              >
                ✕
              </button>
            </div>

            <div
              style={{
                marginBottom: 8,
                fontSize: 12,
                color: "#4b5563",
              }}
            >
              1회당 할인액:{" "}
              <b>
                {Number(
                  currentLogData.partial.discountPerUse || 0
                ).toLocaleString("ko-KR")}
                원
              </b>{" "}
              / 월 최대{" "}
              {currentLogData.partial.maxDiscountCountPerMonth ??
                "제한 없음"}
              회
            </div>

            {/* 기존 로그 리스트 */}
            <div
              style={{
                maxHeight: 180,
                overflowY: "auto",
                border: "1px solid #e5e7eb",
                borderRadius: 6,
                marginBottom: 8,
              }}
            >
              {currentLogData.partial.discountLogs &&
              currentLogData.partial.discountLogs.length > 0 ? (
                <table
                  style={{
                    width: "100%",
                    borderCollapse: "collapse",
                    fontSize: 11,
                  }}
                >
                  <thead>
                    <tr style={{ background: "#f9fafb" }}>
                      <th style={logThStyle}>날짜</th>
                      <th style={logThStyle}>사유</th>
                      <th style={logThStyle}>금액</th>
                      <th style={logThStyle}>메모</th>
                      <th style={logThStyle}>삭제</th>
                    </tr>
                  </thead>
                  <tbody>
                    {currentLogData.partial.discountLogs.map(
                      (lg, idx) => (
                        <tr key={idx}>
                          <td style={logTdStyle}>{lg.date || "-"}</td>
                          <td style={logTdStyle}>
                            {lg.reasonCategory || "-"}
                          </td>
                          <td style={{ ...logTdStyle, textAlign: "right" }}>
                            {Number(lg.amount || 0).toLocaleString("ko-KR")}
                          </td>
                          <td style={logTdStyle}>{lg.note || "-"}</td>
                          <td style={{ ...logTdStyle, textAlign: "center" }}>
                            <button
                              type="button"
                              onClick={() =>
                                handleDeleteDiscountLog(idx)
                              }
                              style={{
                                padding: "1px 6px",
                                fontSize: 10,
                                borderRadius: 4,
                                border: "1px solid #dc2626",
                                background: "#ffffff",
                                color: "#dc2626",
                                cursor: "pointer",
                              }}
                            >
                              삭제
                            </button>
                          </td>
                        </tr>
                      )
                    )}
                  </tbody>
                </table>
              ) : (
                <div
                  style={{
                    padding: 8,
                    fontSize: 11,
                    color: "#9ca3af",
                  }}
                >
                  등록된 할인 내역이 없습니다.
                </div>
              )}
            </div>

            {/* 새 로그 추가 폼 */}
            <div
              style={{
                borderTop: "1px solid #e5e7eb",
                marginTop: 6,
                paddingTop: 8,
              }}
            >
              <div
                style={{
                  fontSize: 12,
                  fontWeight: "bold",
                  marginBottom: 4,
                }}
              >
                새 할인 내역 추가
              </div>
              <div
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  gap: 6,
                  marginBottom: 8,
                  fontSize: 12,
                }}
              >
                <input
                  type="date"
                  value={logEditor.newDate}
                  onChange={(e) =>
                    setLogEditor((prev) =>
                      prev ? { ...prev, newDate: e.target.value } : prev
                    )
                  }
                  style={dateInputStyle}
                />
                <select
                  value={logEditor.newReason}
                  onChange={(e) =>
                    setLogEditor((prev) =>
                      prev ? { ...prev, newReason: e.target.value } : prev
                    )
                  }
                  style={selectStyle}
                >
                  <option value="질병결석">질병 결석</option>
                  <option value="전염병격리">전염병 격리</option>
                  <option value="사전신고여행">사전 신고 여행</option>
                  <option value="기타">기타</option>
                </select>
                <input
                  type="text"
                  placeholder="메모 (선택)"
                  value={logEditor.newNote}
                  onChange={(e) =>
                    setLogEditor((prev) =>
                      prev ? { ...prev, newNote: e.target.value } : prev
                    )
                  }
                  style={{
                    ...textInputStyle,
                    flex: "1 1 160px",
                    minWidth: 160,
                  }}
                />
              </div>

              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  fontSize: 11,
                  color: "#6b7280",
                }}
              >
                <div>
                  현재 할인 반영:{" "}
                  <b>
                    {currentLogData.partial.discountCount || 0}회 /{" "}
                    {Number(
                      currentLogData.partial.discountAmount || 0
                    ).toLocaleString("ko-KR")}
                    원
                  </b>
                </div>
                <div style={{ display: "flex", gap: 6 }}>
                  <button
                    type="button"
                    onClick={() => setLogEditor(null)}
                    style={{
                      padding: "4px 8px",
                      borderRadius: 4,
                      border: "1px solid #d1d5db",
                      background: "#ffffff",
                      fontSize: 11,
                      cursor: "pointer",
                    }}
                  >
                    닫기
                  </button>
                  <button
                    type="button"
                    onClick={handleAddDiscountLog}
                    style={{
                      padding: "4px 10px",
                      borderRadius: 4,
                      border: "none",
                      background: "#2563eb",
                      color: "#ffffff",
                      fontSize: 11,
                      cursor: "pointer",
                    }}
                  >
                    할인 1회 추가
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ----- 스타일 공통 -----
const thStyle = {
  textAlign: "left",
  padding: 6,
  borderBottom: "1px solid #e5e7eb",
  background: "#f9fafb",
  whiteSpace: "nowrap",
};

const tdStyle = {
  padding: 6,
  borderBottom: "1px solid #f3f4f6",
  verticalAlign: "top",
};

const tdStyleCenter = {
  ...tdStyle,
  textAlign: "center",
};

const tdStyleNumber = {
  ...tdStyle,
  textAlign: "right",
};

const navBtnStyle = {
  padding: "4px 8px",
  borderRadius: 4,
  border: "1px solid #d1d5db",
  background: "#ffffff",
  cursor: "pointer",
  fontSize: 12,
};

const numInputStyle = {
  width: 90,
  padding: "3px 4px",
  borderRadius: 4,
  border: "1px solid #d1d5db",
  textAlign: "right",
  fontSize: 12,
};

const dateInputStyle = {
  width: 120,
  padding: "3px 4px",
  borderRadius: 4,
  border: "1px solid #d1d5db",
  fontSize: 12,
};

const textInputStyle = {
  width: "100%",
  minWidth: 140,
  padding: "3px 4px",
  borderRadius: 4,
  border: "1px solid #d1d5db",
  fontSize: 12,
};

const selectStyle = {
  padding: "3px 4px",
  borderRadius: 4,
  border: "1px solid #d1d5db",
  fontSize: 12,
};

const saveBtnStyle = {
  padding: "4px 8px",
  borderRadius: 4,
  border: "none",
  background: "#2563eb",
  color: "#ffffff",
  fontSize: 11,
  cursor: "pointer",
};

const logThStyle = {
  textAlign: "left",
  padding: 4,
  borderBottom: "1px solid #e5e7eb",
};

const logTdStyle = {
  padding: 4,
  borderBottom: "1px solid #f3f4f6",
  fontSize: 11,
};

