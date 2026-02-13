// src/pages/EnrollmentsPage.jsx
import React, { useEffect, useMemo, useState } from "react";
import { db } from "../firebase";
import {
  collection,
  onSnapshot,
  doc,
  getDoc,
  setDoc,
  deleteDoc,
  writeBatch,
  query,
  where,
  limit,
  getDocs,
} from "firebase/firestore";

const enrollLabelByGroup = {
  intensive: "집중학습반",
  elementary: "초등부",
  middle: "중등부",
  middleClinic: "중등부 클리닉",
  high: "고등부",
  advanced: "심화경시반",
};

const dayList = ["월", "화", "수", "목", "금"];

function EnrollmentsPage() {
  const [enrollGroup, setEnrollGroup] = useState("intensive");

  // 🔹 수강신청 전체 설정 (열림 / 예비만 / 완전마감)
  const [enrollConfig, setEnrollConfig] = useState({
    isOpen: true,
    reserveOnly: false,
  });

  // 🔹 기존 enrollments
  const [baseEnrollments, setBaseEnrollments] = useState([]);
  // 🔹 newenroll(신규 신청)
  const [newEnrollments, setNewEnrollments] = useState([]);

  const [selectedSlotKey, setSelectedSlotKey] = useState(null);
  const [moveTargets, setMoveTargets] = useState({});

  // ✅ 고등부(high_enrollments)
  const [highEnrollments, setHighEnrollments] = useState([]);
  const [highForm, setHighForm] = useState({
    studentName: "",
    studentId: "",
    day: "월",
  });

  // ✅ 심화(advanced_by_student)
  const [advancedByStudent, setAdvancedByStudent] = useState([]);
  const [advancedForm, setAdvancedForm] = useState({
    studentName: "",
    studentId: "",
  });

  // =========================
  // ✅ 공통 학생 전체검색 + 탭별 추가 옵션
  // =========================
  const [stuQuery, setStuQuery] = useState("");
  const [stuResults, setStuResults] = useState([]);
  const [stuLoading, setStuLoading] = useState(false);
  const [stuError, setStuError] = useState("");

  // ✅ (집중/초/중) 기본 추가 상태: 신청/예비 드롭다운 1개
  const [addStatus, setAddStatus] = useState("applied"); // applied | reserve

  // ✅ (클리닉) 추가 대상 슬롯 선택
  const [clinicAdd, setClinicAdd] = useState({
    day: "월",
    blockId: "A",
    key: "regular", // regular | extra
  });

  // ✅ (고등) 검색 추가용 요일 선택
  const [highAddDay, setHighAddDay] = useState("월");

  // ✅ (중요) enrollments + newenroll이 섞일 때 key 충돌 방지
  const enrKey = (enr) => `${enr.fromNew ? "new" : "enr"}-${enr.id}`;

  // ✅ 그룹 바뀔 때, 선택/이동 타겟 초기화 (DOM 꼬임 방지 + UX)
  useEffect(() => {
    setSelectedSlotKey(null);
    setMoveTargets({});
    setStuResults([]);
    setStuQuery("");
  }, [enrollGroup]);

  // ✅ base 컬렉션: 그룹별 분기 (middleClinic은 별도 구조)
  const baseColByGroup = (group) => {
    if (group === "intensive") return "intensive_enrollments";
    return "enrollments";
  };

  const isMiddleClinicRow = (enr) => (enr.group || "") === "middleClinic";

  // 🔹 수강신청 설정 실시간 (settings/enrollments)
  useEffect(() => {
    const ref = doc(db, "settings", "enrollments");
    return onSnapshot(
      ref,
      (snap) => {
        if (!snap.exists()) return;
        const data = snap.data() || {};
        setEnrollConfig({
          isOpen: data.isOpen !== undefined ? !!data.isOpen : true,
          reserveOnly: data.reserveOnly !== undefined ? !!data.reserveOnly : false,
        });
      },
      (err) => console.error("수강신청 설정 구독 오류:", err)
    );
  }, []);

  // ✅ enrollments 실시간 (그룹별 컬렉션 분기)
  useEffect(() => {
    // 1) 집중학습반
    if (enrollGroup === "intensive") {
      const ref = collection(db, "intensive_enrollments");
      return onSnapshot(ref, (qs) => {
        const list = qs.docs.map((d) => {
          const data = d.data() || {};
          return {
            id: d.id,
            fromNew: false,
            group: "intensive",
            status: data.status || "applied",
            ...data,
          };
        });
        setBaseEnrollments(list);
      });
    }

   // 2) ✅ 중등 클리닉 (middle_clinic_days → 슬롯형 데이터로 펼치기)
if (enrollGroup === "middleClinic") {
  const ref = collection(db, "middle_clinic_days");
  return onSnapshot(ref, (qs) => {
    const list = [];

    qs.docs.forEach((d) => {
      const data = d.data() || {};

      ["regular", "extra"].forEach((k) => {
        const item = data[k];
        if (!item) return;

        // ✅ (중요) old schema(루트에 studentName/studentId)도 fallback 처리
        const resolvedStudentId =
          item.studentId || data.studentId || d.id;

        const resolvedStudentName =
          item.studentName || data.studentName || "";

        const resolvedDay =
          item.day || data.day || "";

        const resolvedBlockId =
          item.blockId || data.blockId || "";

        list.push({
          id: `${d.id}_${k}`, // 화면용 id
          fromNew: false,
          group: "middleClinic",
          status: "applied",

          day: resolvedDay,
          time: resolvedBlockId, // A/B

          studentId: resolvedStudentId,
          studentName: resolvedStudentName,

          _srcDocId: d.id,
          _srcKey: k,
        });
      });
    });

    setBaseEnrollments(list);
  });
}


    // 3) 초등/중등 (기존 enrollments)
    const ref = collection(db, "enrollments");
    return onSnapshot(ref, (qs) => {
      const list = qs.docs.map((d) => ({
        id: d.id,
        fromNew: false,
        ...d.data(),
      }));
      setBaseEnrollments(list);
    });
  }, [enrollGroup]);

  // newenroll 실시간
  useEffect(() => {
    const ref = collection(db, "newenroll");
    return onSnapshot(ref, (qs) => {
      const list = qs.docs.map((d) => ({
        id: d.id,
        fromNew: true,
        ...d.data(),
      }));
      setNewEnrollments(list);
    });
  }, []);

  // enrollments + newenroll 합치기
  const mergedEnrollments = useMemo(
    () => [...baseEnrollments, ...newEnrollments],
    [baseEnrollments, newEnrollments]
  );

  // ✅ 고등부(high_enrollments) 실시간
  useEffect(() => {
    const ref = collection(db, "high_enrollments");
    return onSnapshot(ref, (qs) => {
      const list = qs.docs.map((d) => ({ id: d.id, ...d.data() }));
      const order = { 월: 1, 화: 2, 수: 3, 목: 4, 금: 5, 토: 6, 일: 0 };
      list.sort((a, b) => {
        const da = order[a.day] ?? 99;
        const dbb = order[b.day] ?? 99;
        if (da !== dbb) return da - dbb;
        return (a.studentName || "").localeCompare(b.studentName || "", "ko-KR");
      });
      setHighEnrollments(list);
    });
  }, []);

  // ✅ 심화(advanced_by_student) 실시간
  useEffect(() => {
    const ref = collection(db, "advanced_by_student");
    return onSnapshot(ref, (qs) => {
      const list = qs.docs.map((d) => ({ id: d.id, ...d.data() }));
      list.sort((a, b) =>
        (a.studentName || "").localeCompare(b.studentName || "", "ko-KR")
      );
      setAdvancedByStudent(list);
    });
  }, []);

  // =========================
  // ✅ 시간표 정의 (슬롯 표시용)
  // =========================
  const enrollSchedules = useMemo(
    () => ({
      intensive: {
        화: ["3시", "4시", "5시"],
        수: ["3시", "4시", "5시"],
        목: ["3시", "4시", "5시"],
      },
      elementary: {
        월: ["2시30분"],
        화: ["3시", "4시"],
        수: ["2시", "3시", "4시"],
        목: ["3시", "4시"],
        금: ["3시", "4시"],
      },
      middle: {
        월: ["3시30분", "5시", "6시30분"],
        화: ["5시", "6시30분"],
        수: ["5시", "6시30분"],
        목: ["5시", "6시30분"],
        금: ["5시", "6시30분"],
      },
      middleClinic: {
        월: ["A", "B"],
        화: ["A", "B"],
        수: ["A"],
        목: ["A", "B"],
        금: ["A", "B"],
      },
    }),
    []
  );

  // =========================
  // ✅ 정원(표시용)
  // =========================
  const capacityByGroup = useMemo(
    () => ({
      intensive: 8,
      middleClinic: 5,
      elementary: null,
      middle: null,
    }),
    []
  );

  // 실제 신청/예비 인원 수 (enrollments + newenroll) - waitlist 제외
  const enrollCounts = useMemo(() => {
    const map = {};
    mergedEnrollments.forEach((e) => {
      const group = e.group || "";
      const day = e.day || "";
      const time = e.time || "";
      const key = `${group}|${day}|${time}`;
      if (!map[key]) map[key] = { applied: 0, reserve: 0 };
      const st = e.status || "applied";
      if (st === "waitlist") return;
      if (st === "reserve") map[key].reserve += 1;
      else map[key].applied += 1;
    });
    return map;
  }, [mergedEnrollments]);

  // adminHold 카운트(보여주기용) - waitlist 제외
  const enrollHoldCounts = useMemo(() => {
    const map = {};
    baseEnrollments.forEach((e) => {
      if (!e.adminHold) return;
      const key = `${e.group || ""}|${e.day || ""}|${e.time || ""}`;
      if (!map[key]) map[key] = { applied: 0, reserve: 0 };
      const st = e.status || "applied";
      if (st === "waitlist") return;
      if (st === "reserve") map[key].reserve += 1;
      else map[key].applied += 1;
    });
    return map;
  }, [baseEnrollments]);

  // =========================
  // ✅ [핵심] 선택 슬롯
  // =========================
  const selectedSlot = useMemo(() => {
    if (!selectedSlotKey) return null;
    const [group, day, time] = selectedSlotKey.split("|");
    if (!group || !day || !time) return null;
    return { key: selectedSlotKey, group, day, time };
  }, [selectedSlotKey]);

  const selectedSlotList = useMemo(() => {
    if (!selectedSlot) return [];
    return mergedEnrollments.filter((e) => {
      const g = e.group || "";
      const d = e.day || "";
      const t = e.time || "";
      const st = e.status || "applied";
      if (st === "waitlist") return false;
      return g === selectedSlot.group && d === selectedSlot.day && t === selectedSlot.time;
    });
  }, [mergedEnrollments, selectedSlot]);

  const appliedList = useMemo(() => {
    if (!selectedSlot) return [];
    return selectedSlotList.filter((e) => (e.status || "applied") === "applied");
  }, [selectedSlot, selectedSlotList]);

  const reserveList = useMemo(() => {
    if (!selectedSlot) return [];
    return selectedSlotList.filter((e) => (e.status || "") === "reserve");
  }, [selectedSlot, selectedSlotList]);

  const pendingList = useMemo(() => {
    if (!selectedSlot) return [];
    return selectedSlotList.filter((e) => {
      const st = e.status || "applied";
      return st !== "applied" && st !== "reserve";
    });
  }, [selectedSlot, selectedSlotList]);

  // =========================
  // ✅ 상태 변경(예비<->신청), 삭제, 이동
  // =========================
  const promoteReserveToApplied = async (enr) => {
    if (isMiddleClinicRow(enr)) {
      alert("중등클리닉은 예비/신청 상태 변경이 아니라 슬롯 이동/삭제로 관리합니다.");
      return;
    }

    if (
      !window.confirm(
        `${enr.studentName || enr.name || ""} 학생의 예비를 '신청(확정)'으로 변경할까요?`
      )
    )
      return;

    try {
      if (enr.fromNew) {
        const ref = doc(db, "newenroll", enr.id);
        await setDoc(
          ref,
          { status: "applied", label: "신청", updatedAt: new Date().toISOString() },
          { merge: true }
        );
        alert("신규 예비가 신청(확정)으로 변경되었습니다.");
        return;
      }

      const batch = writeBatch(db);
      const enrollRef = doc(db, baseColByGroup(enr.group), enr.id);
      batch.update(enrollRef, { status: "applied" });

      const stuName = enr.studentName;
      if (stuName) {
        const stuRef = doc(db, "enrollments_by_student", stuName);
        const stuSnap = await getDoc(stuRef);
        if (stuSnap.exists()) {
          const data = stuSnap.data();
          const appliedArr = Array.isArray(data.applied)
            ? data.applied.map((item) => {
                if (item.group === enr.group && item.day === enr.day && item.time === enr.time) {
                  return { ...item, status: "applied", label: "신청" };
                }
                return item;
              })
            : [];
          batch.set(
            stuRef,
            { ...data, applied: appliedArr, updatedAt: new Date().toISOString() },
            { merge: true }
          );
        }
      }

      await batch.commit();
      alert("예비가 신청(확정)으로 변경되었습니다.");
    } catch (e) {
      console.error("예비→신청 변경 오류:", e);
      alert("변경 중 오류가 발생했습니다.");
    }
  };

  const demoteAppliedToReserve = async (enr) => {
    if (isMiddleClinicRow(enr)) {
      alert("중등클리닉은 예비/신청 상태 변경이 아니라 슬롯 이동/삭제로 관리합니다.");
      return;
    }

    if (
      !window.confirm(
        `${enr.studentName || enr.name || ""} 학생의 '신청(확정)'을 예비로 변경할까요?`
      )
    )
      return;

    try {
      if (enr.fromNew) {
        const ref = doc(db, "newenroll", enr.id);
        await setDoc(
          ref,
          { status: "reserve", label: "신청(예비)", updatedAt: new Date().toISOString() },
          { merge: true }
        );
        alert("신규 신청이 예비로 변경되었습니다.");
        return;
      }

      const batch = writeBatch(db);
      const enrollRef = doc(db, baseColByGroup(enr.group), enr.id);
      batch.update(enrollRef, { status: "reserve" });

      const stuName = enr.studentName;
      if (stuName) {
        const stuRef = doc(db, "enrollments_by_student", stuName);
        const stuSnap = await getDoc(stuRef);
        if (stuSnap.exists()) {
          const data = stuSnap.data();
          const appliedArr = Array.isArray(data.applied)
            ? data.applied.map((item) => {
                if (item.group === enr.group && item.day === enr.day && item.time === enr.time) {
                  return { ...item, status: "reserve", label: "신청(예비)" };
                }
                return item;
              })
            : [];
          batch.set(
            stuRef,
            { ...data, applied: appliedArr, updatedAt: new Date().toISOString() },
            { merge: true }
          );
        }
      }

      await batch.commit();
      alert("신청이 예비로 변경되었습니다.");
    } catch (e) {
      console.error("신청→예비 변경 오류:", e);
      alert("변경 중 오류가 발생했습니다.");
    }
  };

  const deleteEnrollment = async (enr) => {
    if (isMiddleClinicRow(enr)) return alert("중등클리닉은 아래 '삭제(클리닉)' 버튼으로 삭제합니다.");

    if (!window.confirm(`${enr.studentName || enr.name || ""} 학생의 예비 신청을 완전히 삭제할까요?`))
      return;

    try {
      if (enr.fromNew) {
        await deleteDoc(doc(db, "newenroll", enr.id));
        alert("신규 예비 신청이 삭제되었습니다.");
      } else {
        const batch = writeBatch(db);
        const enrollRef = doc(db, baseColByGroup(enr.group), enr.id);
        batch.delete(enrollRef);

        const stuName = enr.studentName;
        if (stuName) {
          const stuRef = doc(db, "enrollments_by_student", stuName);
          const stuSnap = await getDoc(stuRef);
          if (stuSnap.exists()) {
            const data = stuSnap.data();
            const appliedArr = Array.isArray(data.applied)
              ? data.applied.filter(
                  (item) => !(item.group === enr.group && item.day === enr.day && item.time === enr.time)
                )
              : [];
            batch.set(
              stuRef,
              { ...data, applied: appliedArr, updatedAt: new Date().toISOString() },
              { merge: true }
            );
          }
        }

        await batch.commit();
        alert("예비 신청이 삭제되었습니다.");
      }
    } catch (e) {
      console.error("예비 신청 삭제 오류:", e);
      alert("예비 신청 삭제 중 오류가 발생했습니다.");
    }
  };

  // ✅ 중등클리닉 이동/삭제 구현
  const moveMiddleClinic = async (enr, targetValue) => {
    const [newDay, newBlockId, newKey] = (targetValue || "").split("|");
    if (!newDay || !newBlockId || !newKey) return alert("이동할 슬롯을 선택해 주세요.");

    const fromDocId = enr._srcDocId;
    const fromKey = enr._srcKey;
    if (!fromDocId || !fromKey) return alert("원본 클리닉 문서 정보가 없습니다.");

    if (enr.day === newDay && enr.time === newBlockId && fromKey === newKey) {
      return alert("같은 슬롯으로는 이동할 수 없습니다.");
    }

    try {
      const fromRef = doc(db, "middle_clinic_days", fromDocId);

      const targetDocId = enr.studentId;
      if (!targetDocId) return alert("studentId가 없어 이동할 수 없어요.");

      const targetRef = doc(db, "middle_clinic_days", targetDocId);
      const targetSnap = await getDoc(targetRef);
      const targetData = targetSnap.exists() ? targetSnap.data() : {};

      if (targetData?.[newKey]) {
        const ok = window.confirm(
          `이미 ${newKey === "regular" ? "regular" : "extra"} 칸에 데이터가 있어요.\n덮어쓸까요?`
        );
        if (!ok) return;
      }

      const payload = {
        day: newDay,
        blockId: newBlockId,
        studentId: enr.studentId || "",
        studentName: enr.studentName || "",
        updatedAt: new Date().toISOString(),
      };

      await setDoc(fromRef, { [fromKey]: null, updatedAt: new Date().toISOString() }, { merge: true });
      await setDoc(targetRef, { [newKey]: payload, updatedAt: new Date().toISOString() }, { merge: true });

      alert("클리닉 이동 완료!");
    } catch (e) {
      console.error("클리닉 이동 오류:", e);
      alert("클리닉 이동 중 오류가 발생했습니다.");
    }
  };

  const deleteMiddleClinic = async (enr) => {
    const fromDocId = enr._srcDocId;
    const fromKey = enr._srcKey;
    if (!fromDocId || !fromKey) return alert("원본 클리닉 문서 정보가 없습니다.");

    if (!window.confirm(`${enr.studentName || ""} 클리닉(${fromKey})을 삭제할까요?`)) return;

    try {
      const ref = doc(db, "middle_clinic_days", fromDocId);
      await setDoc(ref, { [fromKey]: null, updatedAt: new Date().toISOString() }, { merge: true });
      alert("클리닉 삭제 완료!");
    } catch (e) {
      console.error("클리닉 삭제 오류:", e);
      alert("클리닉 삭제 중 오류가 발생했습니다.");
    }
  };

  const handleMoveEnrollment = async (enr) => {
    if (isMiddleClinicRow(enr)) {
      const target = moveTargets[enrKey(enr)];
      return moveMiddleClinic(enr, target);
    }

    const currentKey = `${enr.day || ""}|${enr.time || ""}`;
    const targetKey = moveTargets[enrKey(enr)] || currentKey;
    const [newDay, newTime] = (targetKey || "").split("|");

    if (!newDay || !newTime) return alert("이동할 요일/시간을 선택해 주세요.");
    if (targetKey === currentKey) return alert("같은 슬롯으로는 이동할 수 없습니다.");

    try {
      if (enr.fromNew) {
        const ref = doc(db, "newenroll", enr.id);
        await setDoc(ref, { day: newDay, time: newTime, updatedAt: new Date().toISOString() }, { merge: true });
        alert("신규 신청 시간이 이동되었습니다.");
      } else {
        const ref = doc(db, baseColByGroup(enr.group), enr.id);
        await setDoc(ref, { day: newDay, time: newTime, updatedAt: new Date().toISOString() }, { merge: true });

        const stuName = enr.studentName;
        if (stuName) {
          const stuRef = doc(db, "enrollments_by_student", stuName);
          const stuSnap = await getDoc(stuRef);
          if (stuSnap.exists()) {
            const data = stuSnap.data();
            const appliedArr = Array.isArray(data.applied)
              ? data.applied.map((item) => {
                  if (item.group === enr.group && item.day === enr.day && item.time === enr.time) {
                    return { ...item, day: newDay, time: newTime };
                  }
                  return item;
                })
              : [];
            await setDoc(stuRef, { ...data, applied: appliedArr, updatedAt: new Date().toISOString() }, { merge: true });
          }
        }

        alert("재원생 신청 시간이 이동되었습니다.");
      }
    } catch (e) {
      console.error("학생 시간 이동 오류:", e);
      alert("학생 시간 이동 중 오류가 발생했습니다.");
    }
  };

  // =========================
  // ✅ adminHold(표시용 인원)
  // =========================
  const addShowApplicant = async (group, day, time, status = "applied") => {
    if (group === "middleClinic") {
      alert("중등클리닉은 표시용 인원을 여기서 추가하지 않습니다.");
      return;
    }
    try {
      await setDoc(doc(collection(db, baseColByGroup(group))), {
        group,
        day,
        time,
        status,
        adminHold: true,
        studentName: "(보여주기)",
        createdAt: new Date().toISOString(),
      });
    } catch (e) {
      console.error("보여주기 인원 추가 오류:", e);
      alert("보여주기 인원 추가 중 오류");
    }
  };

  const removeShowApplicant = async (group, day, time, status = "applied") => {
    if (group === "middleClinic") {
      alert("중등클리닉은 표시용 인원을 여기서 삭제하지 않습니다.");
      return;
    }
    try {
      const qy = query(
        collection(db, baseColByGroup(group)),
        where("group", "==", group),
        where("day", "==", day),
        where("time", "==", time),
        where("status", "==", status),
        where("adminHold", "==", true),
        limit(1)
      );
      const snap = await getDocs(qy);
      if (snap.empty) return alert("보여주기 인원이 없습니다.");
      await deleteDoc(snap.docs[0].ref);
    } catch (e) {
      console.error("보여주기 인원 삭제 오류:", e);
      alert("보여주기 인원 삭제 중 오류");
    }
  };

  // =========================
  // ✅ 전체 리셋
  // =========================
  const handleResetEnrollments = async () => {
    if (
      !window.confirm(
        "⚠️ enrollments / enrollments_by_student / intensive_enrollments 컬렉션의 모든 문서를 삭제합니다. 계속할까요?"
      )
    )
      return;

    try {
      const snap1 = await getDocs(collection(db, "enrollments"));
      await Promise.all(snap1.docs.map((d) => deleteDoc(d.ref)));

      const snapInt = await getDocs(collection(db, "intensive_enrollments"));
      await Promise.all(snapInt.docs.map((d) => deleteDoc(d.ref)));

      const snap2 = await getDocs(collection(db, "enrollments_by_student"));
      await Promise.all(snap2.docs.map((d) => deleteDoc(d.ref)));

      alert("수강신청 데이터가 모두 삭제되었습니다.");
    } catch (e) {
      console.error("수강신청 리셋 오류:", e);
      alert("삭제 중 오류가 발생했습니다.");
    }
  };

  // =========================
  // ✅ 수강신청 상태 토글
  // =========================
  const setOpenNormal = async () => {
    try {
      await setDoc(
        doc(db, "settings", "enrollments"),
        { isOpen: true, reserveOnly: false, updatedAt: new Date().toISOString() },
        { merge: true }
      );
      alert("수강신청을 '정상 접수 중' 상태로 변경했습니다.");
    } catch (e) {
      console.error("수강신청 열기 오류:", e);
      alert("수강신청 열기 중 오류가 발생했습니다.");
    }
  };

  const setReserveOnly = async () => {
    try {
      await setDoc(
        doc(db, "settings", "enrollments"),
        { isOpen: true, reserveOnly: true, updatedAt: new Date().toISOString() },
        { merge: true }
      );
      alert("수강신청을 '예비만 접수' 상태로 변경했습니다.");
    } catch (e) {
      console.error("예비만 상태 변경 오류:", e);
      alert("예비만 상태로 변경 중 오류가 발생했습니다.");
    }
  };

  const setClosed = async () => {
    if (!window.confirm("수강신청을 완전히 마감할까요?")) return;
    try {
      await setDoc(
        doc(db, "settings", "enrollments"),
        { isOpen: false, reserveOnly: false, updatedAt: new Date().toISOString() },
        { merge: true }
      );
      alert("수강신청을 '완전 마감' 상태로 변경했습니다.");
    } catch (e) {
      console.error("수강신청 마감 오류:", e);
      alert("수강신청 마감 중 오류가 발생했습니다.");
    }
  };

  // =========================
  // ✅ 고등부 helpers
  // =========================
  const highByDay = useMemo(() => {
    const map = {};
    dayList.forEach((d) => (map[d] = []));
    highEnrollments.forEach((x) => {
      const d = x.day || "";
      if (!map[d]) map[d] = [];
      map[d].push(x);
    });
    Object.keys(map).forEach((d) => {
      map[d].sort((a, b) =>
        (a.studentName || "").localeCompare(b.studentName || "", "ko-KR")
      );
    });
    return map;
  }, [highEnrollments]);

  const addHighEnrollment = async () => {
    const name = (highForm.studentName || "").trim();
    const sid = (highForm.studentId || "").trim();
    const day = highForm.day;

    if (!name || !sid || !day) return alert("학생이름 / studentId / 요일을 입력해 주세요.");
    const docId = `${sid}|${day}`;

    try {
      await setDoc(doc(db, "high_enrollments", docId), {
        createdAt: new Date().toISOString(),
        day,
        studentId: sid,
        studentName: name,
      });
      setHighForm({ studentName: "", studentId: "", day: "월" });
      alert("고등부 요일 등록 완료!");
    } catch (e) {
      console.error("high_enrollments 추가 오류:", e);
      alert("고등부 등록 중 오류가 발생했습니다.");
    }
  };

  const deleteHighEnrollment = async (item) => {
    if (!window.confirm(`${item.studentName || ""} (${item.day || ""}) 등록을 삭제할까요?`))
      return;
    try {
      await deleteDoc(doc(db, "high_enrollments", item.id));
    } catch (e) {
      console.error("high_enrollments 삭제 오류:", e);
      alert("삭제 중 오류가 발생했습니다.");
    }
  };

  // =========================
  // ✅ 심화 helpers
  // =========================
  const advancedCounts = useMemo(() => {
    let applied = 0;
    let notApplied = 0;
    advancedByStudent.forEach((x) => {
      if (x.applied === true) applied += 1;
      else notApplied += 1;
    });
    return { applied, notApplied, total: applied + notApplied };
  }, [advancedByStudent]);

  const addAdvancedStudent = async () => {
    const name = (advancedForm.studentName || "").trim();
    const sid = (advancedForm.studentId || "").trim();
    if (!name || !sid) return alert("학생이름 / studentId를 입력해 주세요.");

    try {
      await setDoc(
        doc(db, "advanced_by_student", sid),
        {
          applied: true,
          studentId: sid,
          studentName: name,
          updatedAt: new Date().toISOString(),
        },
        { merge: true }
      );
      setAdvancedForm({ studentName: "", studentId: "" });
      alert("심화경시반 등록 완료!");
    } catch (e) {
      console.error("advanced_by_student 추가 오류:", e);
      alert("심화 등록 중 오류가 발생했습니다.");
    }
  };

  const toggleAdvancedApplied = async (item) => {
    try {
      await setDoc(
        doc(db, "advanced_by_student", item.id),
        { applied: !item.applied, updatedAt: new Date().toISOString() },
        { merge: true }
      );
    } catch (e) {
      console.error("advanced applied 토글 오류:", e);
      alert("변경 중 오류가 발생했습니다.");
    }
  };

  const deleteAdvancedStudent = async (item) => {
    if (!window.confirm(`${item.studentName || ""} 심화 데이터를 삭제할까요?`)) return;
    try {
      await deleteDoc(doc(db, "advanced_by_student", item.id));
    } catch (e) {
      console.error("advanced_by_student 삭제 오류:", e);
      alert("삭제 중 오류가 발생했습니다.");
    }
  };

  // =========================
  // ✅ 현재 그룹의 슬롯 렌더링을 위해 시간표 기반 루프
  // =========================
  const currentScheduleEntries = useMemo(() => {
    const sch = enrollSchedules[enrollGroup] || {};
    return Object.entries(sch);
  }, [enrollSchedules, enrollGroup]);

  // ✅ 중등클리닉 이동 옵션
  const clinicMoveOptions = useMemo(() => {
    const sch = enrollSchedules.middleClinic || {};
    const opts = [];
    Object.entries(sch).forEach(([d, times]) => {
      (times || []).forEach((t) => {
        opts.push({ value: `${d}|${t}|regular`, label: `${d} ${t} (regular)` });
        opts.push({ value: `${d}|${t}|extra`, label: `${d} ${t} (extra)` });
      });
    });
    return opts;
  }, [enrollSchedules]);

  // =========================
  // ✅ 학생 전체검색 (이름 prefix + studentId prefix)
  // =========================
  const searchStudents = async (q) => {
    const keyword = (q || "").trim();
    setStuQuery(q);
    setStuError("");

    if (!keyword) {
      setStuResults([]);
      return;
    }

    try {
      setStuLoading(true);

      const lower = keyword.toLowerCase();
      const lowerEnd = lower + "\uf8ff";

      const nameQueryLower = query(
        collection(db, "students"),
        where("studentNameLower", ">=", lower),
        where("studentNameLower", "<=", lowerEnd),
        limit(20)
      );

      const nameQuery = query(
        collection(db, "students"),
        where("studentName", ">=", keyword),
        where("studentName", "<=", keyword + "\uf8ff"),
        limit(20)
      );

      const idQuery = query(
        collection(db, "students"),
        where("studentId", ">=", keyword),
        where("studentId", "<=", keyword + "\uf8ff"),
        limit(20)
      );

      const [snapA, snapB, snapC] = await Promise.all([
        getDocs(nameQueryLower).catch(() => null),
        getDocs(nameQuery).catch(() => null),
        getDocs(idQuery).catch(() => null),
      ]);

      const raw = [];
      [snapA, snapB, snapC].forEach((snap) => {
        if (!snap || !snap.docs) return;
        snap.docs.forEach((d) => raw.push({ id: d.id, ...d.data() }));
      });

      const uniqMap = new Map();
      raw.forEach((x) => {
        const key = (x.studentId || "").trim() || x.id;
        if (!uniqMap.has(key)) uniqMap.set(key, x);
      });

      const list = Array.from(uniqMap.values());
      list.sort((a, b) =>
        (a.studentName || "").localeCompare(b.studentName || "", "ko-KR")
      );

      setStuResults(list.slice(0, 30));
    } catch (e) {
      console.error("학생 검색 오류:", e);
      setStuError("검색 중 오류가 발생했어요.");
    } finally {
      setStuLoading(false);
    }
  };

  // =========================
  // ✅ (집중/초/중) 선택 슬롯에 학생 추가
  // =========================
  const addStudentToSelectedSlot = async (student, status = "applied") => {
    if (!selectedSlot) return alert("먼저 시간표에서 슬롯(요일/시간)을 선택해 주세요!");
    if (selectedSlot.group === "middleClinic") {
      return alert("클리닉은 위 검색패널의 '클리닉 슬롯'으로 넣어주세요.");
    }

    const studentName = (student.studentName || "").trim();
    const studentId = (student.studentId || student.id || "").trim();
    if (!studentName || !studentId) return alert("학생 정보가 부족해요(studentName/studentId).");

    const ok = window.confirm(
      `[${enrollLabelByGroup[selectedSlot.group]}] ${selectedSlot.day} ${selectedSlot.time}\n` +
        `${studentName} 학생을 "${status === "reserve" ? "예비" : "신청"}"로 추가할까요?`
    );
    if (!ok) return;

    try {
      const col = baseColByGroup(selectedSlot.group);
      const docId = `${studentId}|${selectedSlot.group}|${selectedSlot.day}|${selectedSlot.time}`;

      await setDoc(
        doc(db, col, docId),
        {
          group: selectedSlot.group,
          day: selectedSlot.day,
          time: selectedSlot.time,
          status,
          label: status === "reserve" ? "신청(예비)" : "신청",
          studentId,
          studentName,
          adminHold: false,
          updatedAt: new Date().toISOString(),
          createdAt: new Date().toISOString(),
        },
        { merge: true }
      );

      const stuRef = doc(db, "enrollments_by_student", studentName);
      const stuSnap = await getDoc(stuRef);

      const newItem = {
        group: selectedSlot.group,
        day: selectedSlot.day,
        time: selectedSlot.time,
        status,
        label: status === "reserve" ? "신청(예비)" : "신청",
        studentId,
        studentName,
        updatedAt: new Date().toISOString(),
      };

      if (!stuSnap.exists()) {
        await setDoc(stuRef, { applied: [newItem], updatedAt: new Date().toISOString() }, { merge: true });
      } else {
        const data = stuSnap.data() || {};
        const arr = Array.isArray(data.applied) ? data.applied : [];
        const next = [
          ...arr.filter((x) => !(x.group === newItem.group && x.day === newItem.day && x.time === newItem.time)),
          newItem,
        ];
        await setDoc(stuRef, { ...data, applied: next, updatedAt: new Date().toISOString() }, { merge: true });
      }

      alert("✅ 슬롯에 추가 완료!");
    } catch (e) {
      console.error("슬롯 추가 오류:", e);
      alert("추가 중 오류가 발생했습니다.");
    }
  };

  // =========================
  // ✅ (클리닉) 학생 추가
  // =========================
  const addStudentToClinic = async (student) => {
    const studentName = (student.studentName || "").trim();
    const studentId = (student.studentId || student.id || "").trim();
    if (!studentName || !studentId) return alert("학생 정보가 부족해요(studentName/studentId).");

    const { day, blockId, key } = clinicAdd;
    if (!day || !blockId || !key) return alert("클리닉 슬롯(day/A-B/regular-extra)을 선택해 주세요.");

    const ok = window.confirm(`[중등부 클리닉] ${day} ${blockId} (${key})\n${studentName} 학생을 추가할까요?`);
    if (!ok) return;

    try {
      const ref = doc(db, "middle_clinic_days", studentId);
      const snap = await getDoc(ref);
      const data = snap.exists() ? snap.data() : {};

      if (data?.[key]) {
        const overwrite = window.confirm(`이미 ${key} 칸에 데이터가 있어요.\n덮어쓸까요?`);
        if (!overwrite) return;
      }

      const payload = { day, blockId, studentId, studentName, updatedAt: new Date().toISOString() };

      await setDoc(ref, { [key]: payload, updatedAt: new Date().toISOString() }, { merge: true });
      alert("✅ 클리닉 추가 완료!");
    } catch (e) {
      console.error("클리닉 추가 오류:", e);
      alert("클리닉 추가 중 오류가 발생했습니다.");
    }
  };

  // =========================
  // ✅ (고등) 학생 추가
  // =========================
  const addStudentToHigh = async (student) => {
    const name = (student.studentName || "").trim();
    const sid = (student.studentId || student.id || "").trim();
    const day = highAddDay;
    if (!name || !sid || !day) return alert("학생이름/studentId/요일이 필요해요.");

    const ok = window.confirm(`[고등부] ${day}\n${name} 학생을 등록할까요?`);
    if (!ok) return;

    try {
      const docId = `${sid}|${day}`;
      await setDoc(doc(db, "high_enrollments", docId), {
        createdAt: new Date().toISOString(),
        day,
        studentId: sid,
        studentName: name,
      });
      alert("✅ 고등부 등록 완료!");
    } catch (e) {
      console.error("고등부 등록 오류:", e);
      alert("고등부 등록 중 오류가 발생했습니다.");
    }
  };

  // =========================
  // ✅ (심화) 학생 추가
  // =========================
  const addStudentToAdvanced = async (student) => {
    const name = (student.studentName || "").trim();
    const sid = (student.studentId || student.id || "").trim();
    if (!name || !sid) return alert("학생이름/studentId가 필요해요.");

    const ok = window.confirm(`[심화경시반]\n${name} 학생을 '신청'으로 추가할까요?`);
    if (!ok) return;

    try {
      await setDoc(
        doc(db, "advanced_by_student", sid),
        { applied: true, studentId: sid, studentName: name, updatedAt: new Date().toISOString() },
        { merge: true }
      );
      alert("✅ 심화 신청 추가 완료!");
    } catch (e) {
      console.error("심화 추가 오류:", e);
      alert("심화 추가 중 오류가 발생했습니다.");
    }
  };

  // ✅ 현재 탭에 맞춰 검색 결과 추가
  const addStudentFromSearch = async (student) => {
    if (enrollGroup === "high") return addStudentToHigh(student);
    if (enrollGroup === "advanced") return addStudentToAdvanced(student);
    if (enrollGroup === "middleClinic") return addStudentToClinic(student);
    return addStudentToSelectedSlot(student, addStatus);
  };

  return (
    <div style={{ fontSize: 13 }}>
      {/* 상단 헤더 */}
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 8,
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 8,
        }}
      >
        <h2 style={{ fontSize: 18, fontWeight: "bold" }}>
          수강신청 현황{" "}
          <span style={{ fontSize: 12, color: "#6b7280" }}>
            ({enrollLabelByGroup[enrollGroup]})
          </span>
        </h2>

        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4 }}>
          {/* 상태 뱃지 + 버튼 */}
          <div style={{ display: "flex", flexWrap: "wrap", gap: 4, alignItems: "center", justifyContent: "flex-end" }}>
            <span
              style={{
                fontSize: 11,
                padding: "2px 8px",
                borderRadius: 999,
                backgroundColor: enrollConfig.isOpen ? (enrollConfig.reserveOnly ? "#fef3c7" : "#dcfce7") : "#fee2e2",
                color: enrollConfig.isOpen ? (enrollConfig.reserveOnly ? "#92400e" : "#166534") : "#b91c1c",
                border: "1px solid rgba(0,0,0,0.05)",
              }}
            >
              {enrollConfig.isOpen
                ? enrollConfig.reserveOnly
                  ? "현재 상태: 수강신청 마감, 예비만 접수"
                  : "현재 상태: 수강신청 접수 중"
                : "현재 상태: 수강신청 완전 마감"}
            </span>

            <button type="button" onClick={setOpenNormal} style={{ padding: "2px 8px", fontSize: 11, borderRadius: 999, border: "1px solid #d1d5db", background: "white", cursor: "pointer" }}>
              접수 열기
            </button>
            <button type="button" onClick={setReserveOnly} style={{ padding: "2px 8px", fontSize: 11, borderRadius: 999, border: "1px solid #facc15", background: "white", cursor: "pointer" }}>
              예비만
            </button>
            <button type="button" onClick={setClosed} style={{ padding: "2px 8px", fontSize: 11, borderRadius: 999, border: "1px solid #dc2626", background: "white", color: "#b91c1c", cursor: "pointer" }}>
              완전 마감
            </button>
          </div>

          {/* 그룹 탭 + 리셋 */}
          <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 2 }}>
            <div style={{ display: "inline-flex", borderRadius: 999, border: "1px solid #e5e7eb", overflow: "hidden" }}>
              {["intensive", "elementary", "middle", "middleClinic", "high", "advanced"].map((g) => (
                <button
                  key={`tab-${g}`}
                  type="button"
                  onClick={() => setEnrollGroup(g)}
                  style={{
                    padding: "4px 10px",
                    fontSize: 12,
                    border: "none",
                    cursor: "pointer",
                    background: enrollGroup === g ? "#3b82f6" : "rgba(255,255,255,0.9)",
                    color: enrollGroup === g ? "white" : "#374151",
                    fontWeight: "bold",
                  }}
                >
                  {enrollLabelByGroup[g]}
                </button>
              ))}
            </div>

            <button onClick={handleResetEnrollments} style={{ padding: "6px 10px", borderRadius: 4, border: "1px solid #dc2626", background: "white", color: "#dc2626", cursor: "pointer", fontSize: 12 }}>
              전체 리셋
            </button>
          </div>
        </div>
      </div>

      {/* 본문 박스 */}
      <div style={{ border: "1px solid #e5e7eb", borderRadius: 8, padding: 8, background: "white" }}>
        {/* 공통 검색 패널 */}
        <div style={{ marginBottom: 10, padding: 10, border: "1px solid #e5e7eb", borderRadius: 10, background: "#f9fafb" }}>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", justifyContent: "space-between" }}>
            <div style={{ fontWeight: "bold", fontSize: 13 }}>
              학생 전체검색 → 현재 탭에 바로 추가
              <span style={{ marginLeft: 6, fontSize: 12, color: "#6b7280" }}>
                (현재: {enrollLabelByGroup[enrollGroup]})
              </span>
            </div>

            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
              {(enrollGroup === "intensive" || enrollGroup === "elementary" || enrollGroup === "middle") && (
                <>
                  <span style={{ fontSize: 12, color: "#6b7280" }}>추가 상태:</span>
                  <select value={addStatus} onChange={(e) => setAddStatus(e.target.value)} style={{ padding: "6px 8px", borderRadius: 6, border: "1px solid #d1d5db", fontSize: 12 }}>
                    <option value="applied">신청(확정)</option>
                    <option value="reserve">예비</option>
                  </select>

                  <span style={{ fontSize: 12, color: "#6b7280" }}>
                    {selectedSlot && selectedSlot.group === enrollGroup
                      ? `선택 슬롯: ${selectedSlot.day} ${selectedSlot.time}`
                      : "⚠️ 슬롯 먼저 클릭"}
                  </span>
                </>
              )}

              {enrollGroup === "middleClinic" && (
                <>
                  <span style={{ fontSize: 12, color: "#6b7280" }}>클리닉 슬롯:</span>
                  <select value={clinicAdd.day} onChange={(e) => setClinicAdd((p) => ({ ...p, day: e.target.value }))} style={{ padding: "6px 8px", borderRadius: 6, border: "1px solid #d1d5db", fontSize: 12 }}>
                    {dayList.map((d) => (
                      <option key={`cad-day-${d}`} value={d}>
                        {d}
                      </option>
                    ))}
                  </select>
                  <select value={clinicAdd.blockId} onChange={(e) => setClinicAdd((p) => ({ ...p, blockId: e.target.value }))} style={{ padding: "6px 8px", borderRadius: 6, border: "1px solid #d1d5db", fontSize: 12 }}>
                    <option value="A">A</option>
                    <option value="B">B</option>
                  </select>
                  <select value={clinicAdd.key} onChange={(e) => setClinicAdd((p) => ({ ...p, key: e.target.value }))} style={{ padding: "6px 8px", borderRadius: 6, border: "1px solid #d1d5db", fontSize: 12 }}>
                    <option value="regular">regular</option>
                    <option value="extra">extra</option>
                  </select>
                </>
              )}

              {enrollGroup === "high" && (
                <>
                  <span style={{ fontSize: 12, color: "#6b7280" }}>등록 요일:</span>
                  <select value={highAddDay} onChange={(e) => setHighAddDay(e.target.value)} style={{ padding: "6px 8px", borderRadius: 6, border: "1px solid #d1d5db", fontSize: 12 }}>
                    {dayList.map((d) => (
                      <option key={`hday-${d}`} value={d}>
                        {d}
                      </option>
                    ))}
                  </select>
                </>
              )}

              {enrollGroup === "advanced" && (
                <span style={{ fontSize: 12, color: "#6b7280" }}>검색 결과에서 “+추가” 누르면 심화 신청으로 들어가요.</span>
              )}
            </div>
          </div>

          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", marginTop: 10 }}>
            <input
              value={stuQuery}
              onChange={(e) => searchStudents(e.target.value)}
              placeholder="이름 또는 studentId로 검색"
              style={{ padding: "8px 10px", borderRadius: 8, border: "1px solid #d1d5db", fontSize: 12, width: 320, background: "white" }}
            />

            <button type="button" onClick={() => searchStudents(stuQuery)} style={{ padding: "8px 12px", borderRadius: 8, border: "1px solid #d1d5db", background: "white", cursor: "pointer", fontSize: 12, fontWeight: "bold" }}>
              검색
            </button>

            {stuLoading && <span style={{ fontSize: 12, color: "#6b7280" }}>검색중...</span>}
            {stuError && <span style={{ fontSize: 12, color: "#dc2626" }}>{stuError}</span>}
          </div>

          {stuResults.length > 0 && (
            <div style={{ marginTop: 10, display: "flex", flexWrap: "wrap", gap: 6 }}>
              {stuResults.map((s) => (
                <div
                  key={`sr-${s.studentId || s.id}`}
                  style={{ border: "1px solid #e5e7eb", borderRadius: 999, padding: "6px 10px", background: "white", display: "flex", gap: 8, alignItems: "center" }}
                >
                  <span style={{ fontWeight: "bold", fontSize: 12 }}>{s.studentName || "-"}</span>
                  <span style={{ fontSize: 11, color: "#6b7280" }}>{s.studentId || s.id}</span>

                  <button
                    type="button"
                    onClick={() => addStudentFromSearch(s)}
                    style={{ border: "1px solid #2563eb", background: "#2563eb", color: "white", cursor: "pointer", borderRadius: 999, fontSize: 11, padding: "3px 10px", fontWeight: "bold" }}
                  >
                    + 추가
                  </button>
                </div>
              ))}
            </div>
          )}

          {stuResults.length === 0 && stuQuery.trim().length > 0 && !stuLoading && (
            <div style={{ marginTop: 10, fontSize: 12, color: "#9ca3af" }}>검색 결과가 없어요.</div>
          )}
        </div>

        {/* ✅✅✅ 탭별 화면 전체를 key로 통째로 리마운트 */}
        <div key={`enroll-group-pane-${enrollGroup}`}>
          {(enrollGroup === "intensive" || enrollGroup === "elementary" || enrollGroup === "middle" || enrollGroup === "middleClinic") && (
            <>
              <div style={{ marginBottom: 8, fontSize: 12, color: "#4b5563" }}>
                {enrollGroup === "intensive" && (
                  <>
                    집중학습반은 <b>화/수/목</b> 운영 · 각 요일 <b>3시/4시/5시</b> 슬롯입니다. (정원 <b>8명</b>)
                  </>
                )}
                {enrollGroup === "middleClinic" && (
                  <>
                    중등부 클리닉은 요일별 <b>A/B</b> 슬롯로 운영됩니다. (정원 <b>5명</b>)<br />
                    실제 저장은 <b>middle_clinic_days</b> 문서의 <b>regular / extra</b> 안에 <b>day, blockId(A/B), studentId, studentName</b> 형태로 들어갑니다.<br />
                    <span style={{ color: "#16a34a", fontWeight: "bold" }}>✅ 이 화면에서 클리닉도 이동/삭제 가능하게 열어두었습니다.</span>
                  </>
                )}
              </div>

              {/* 시간표 */}
              <div style={{ overflowX: "auto" }}>
                <table style={{ minWidth: 560, width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                  <thead>
                    <tr style={{ background: "#f9fafb" }}>
                      <th style={{ textAlign: "left", padding: 8, borderBottom: "1px solid #e5e7eb", width: 80 }}>요일</th>
                      <th style={{ textAlign: "left", padding: 8, borderBottom: "1px solid #e5e7eb" }}>슬롯 (신청 / 예비)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {currentScheduleEntries.map(([day, times]) => (
                      <tr key={`row-${enrollGroup}-${day}`}>
                        <td style={{ padding: 8, borderBottom: "1px solid #f3f4f6", fontWeight: "bold", whiteSpace: "nowrap" }}>{day}</td>
                        <td style={{ padding: 8, borderBottom: "1px solid #f3f4f6" }}>
                          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                            {(times || []).map((time) => {
                              const slotKey = `${enrollGroup}|${day}|${time}`;
                              const cnt = enrollCounts[slotKey] || { applied: 0, reserve: 0 };
                              const total = cnt.applied + cnt.reserve;
                              const hold = enrollHoldCounts[slotKey] || { applied: 0, reserve: 0 };
                              const cap = capacityByGroup[enrollGroup];

                              const holdDisabled = enrollGroup === "middleClinic";

                              return (
                                <div
                                  key={`slot-${enrollGroup}-${day}-${time}`}
                                  style={{
                                    padding: 8,
                                    borderRadius: 8,
                                    border: "1px solid #e5e7eb",
                                    background: "white",
                                    display: "flex",
                                    flexDirection: "column",
                                    alignItems: "flex-start",
                                    minWidth: 170,
                                  }}
                                >
                                  <button
                                    type="button"
                                    onClick={() => setSelectedSlotKey(slotKey)}
                                    style={{
                                      padding: "4px 8px",
                                      borderRadius: 6,
                                      border: "1px solid #e5e7eb",
                                      background: selectedSlotKey === slotKey ? "#eff6ff" : "white",
                                      cursor: "pointer",
                                      width: "100%",
                                    }}
                                  >
                                    <div style={{ fontWeight: "bold", display: "flex", justifyContent: "space-between", gap: 8 }}>
                                      <span>{time}</span>
                                      {cap ? <span style={{ fontSize: 11, color: "#6b7280" }}>정원 {cap}</span> : null}
                                    </div>
                                    <div style={{ marginTop: 4, fontSize: 11, color: "#6b7280" }}>
                                      신청 {cnt.applied} / 예비 {cnt.reserve}
                                      <span style={{ marginLeft: 4, color: "#9ca3af" }}>(총 {total})</span>
                                    </div>
                                  </button>

                                  {/* adminHold */}
                                  <div style={{ marginTop: 6, display: "flex", flexDirection: "column", gap: 4, fontSize: 11, color: "#6b7280", width: "100%" }}>
                                    <div style={{ fontWeight: "bold", marginBottom: 2 }}>표시용 인원 (adminHold)</div>

                                    <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                                      <span style={{ width: 42 }}>신청</span>
                                      <span style={{ minWidth: 20, textAlign: "right" }}>{hold.applied || 0}</span>
                                      <button
                                        type="button"
                                        disabled={holdDisabled}
                                        onClick={() => addShowApplicant(enrollGroup, day, time, "applied")}
                                        style={{
                                          padding: "1px 6px",
                                          fontSize: 10,
                                          borderRadius: 4,
                                          border: "1px solid #e5e7eb",
                                          background: holdDisabled ? "#f3f4f6" : "white",
                                          cursor: holdDisabled ? "not-allowed" : "pointer",
                                          opacity: holdDisabled ? 0.6 : 1,
                                        }}
                                      >
                                        +1
                                      </button>
                                      <button
                                        type="button"
                                        disabled={holdDisabled}
                                        onClick={() => removeShowApplicant(enrollGroup, day, time, "applied")}
                                        style={{
                                          padding: "1px 6px",
                                          fontSize: 10,
                                          borderRadius: 4,
                                          border: "1px solid #e5e7eb",
                                          background: holdDisabled ? "#f3f4f6" : "white",
                                          cursor: holdDisabled ? "not-allowed" : "pointer",
                                          opacity: holdDisabled ? 0.6 : 1,
                                        }}
                                      >
                                        -1
                                      </button>
                                    </div>

                                    <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                                      <span style={{ width: 42 }}>예비</span>
                                      <span style={{ minWidth: 20, textAlign: "right" }}>{hold.reserve || 0}</span>
                                      <button
                                        type="button"
                                        disabled={holdDisabled}
                                        onClick={() => addShowApplicant(enrollGroup, day, time, "reserve")}
                                        style={{
                                          padding: "1px 6px",
                                          fontSize: 10,
                                          borderRadius: 4,
                                          border: "1px solid #e5e7eb",
                                          background: holdDisabled ? "#f3f4f6" : "white",
                                          cursor: holdDisabled ? "not-allowed" : "pointer",
                                          opacity: holdDisabled ? 0.6 : 1,
                                        }}
                                      >
                                        +1
                                      </button>
                                      <button
                                        type="button"
                                        disabled={holdDisabled}
                                        onClick={() => removeShowApplicant(enrollGroup, day, time, "reserve")}
                                        style={{
                                          padding: "1px 6px",
                                          fontSize: 10,
                                          borderRadius: 4,
                                          border: "1px solid #e5e7eb",
                                          background: holdDisabled ? "#f3f4f6" : "white",
                                          cursor: holdDisabled ? "not-allowed" : "pointer",
                                          opacity: holdDisabled ? 0.6 : 1,
                                        }}
                                      >
                                        -1
                                      </button>
                                    </div>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* 선택된 슬롯 상세 (안전장치: group 일치할 때만) */}
              {selectedSlot && selectedSlot.group === enrollGroup && (
                <div style={{ marginTop: 12, paddingTop: 8, borderTop: "1px dashed #e5e7eb" }}>
                  <div style={{ fontWeight: "bold", marginBottom: 8, fontSize: 13 }}>
                    [{enrollLabelByGroup[selectedSlot.group] || selectedSlot.group}] {selectedSlot.day} {selectedSlot.time} 신청 현황
                  </div>

                  <div style={{ display: "flex", flexWrap: "wrap", gap: 16 }}>
                    {/* 신청 */}
                    <div style={{ minWidth: 220, flex: "1 1 220px" }}>
                      <div style={{ fontSize: 12, fontWeight: "bold", marginBottom: 4 }}>
                        신청 ({appliedList.length}명)
                      </div>
                      {appliedList.length === 0 ? (
                        <div style={{ fontSize: 11, color: "#9ca3af" }}>신청 인원이 없습니다.</div>
                      ) : (
                        <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
                          {appliedList.map((enr) => (
                            <li key={`applied-${enrKey(enr)}`} style={{ padding: "4px 0", borderBottom: "1px dotted #e5e7eb" }}>
                              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                                <span>
                                  {enr.studentName || enr.name || "-"}
                                  {enr.fromNew ? " (신규)" : ""}
                                  {enr.adminHold ? " (표시용)" : ""}
                                  {isMiddleClinicRow(enr) ? ` (${enr._srcKey})` : ""}
                                </span>
                                <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
                                  {!isMiddleClinicRow(enr) && (
                                    <button
                                      type="button"
                                      onClick={() => demoteAppliedToReserve(enr)}
                                      style={{ padding: "1px 6px", fontSize: 10, borderRadius: 4, border: "1px solid #d1d5db", background: "white", cursor: "pointer" }}
                                    >
                                      예비로
                                    </button>
                                  )}
                                  {isMiddleClinicRow(enr) && (
                                    <button
                                      type="button"
                                      onClick={() => deleteMiddleClinic(enr)}
                                      style={{ padding: "1px 6px", fontSize: 10, borderRadius: 4, border: "1px solid #dc2626", background: "white", color: "#dc2626", cursor: "pointer" }}
                                    >
                                      삭제(클리닉)
                                    </button>
                                  )}
                                </div>
                              </div>

                              {/* 이동 */}
                              <div style={{ marginTop: 3, display: "flex", gap: 4, alignItems: "center", fontSize: 11 }}>
                                <span style={{ color: "#6b7280" }}>이동:</span>

                                {isMiddleClinicRow(enr) ? (
                                  <select
                                    value={moveTargets[enrKey(enr)] || `${selectedSlot.day}|${selectedSlot.time}|${enr._srcKey || "regular"}`}
                                    onChange={(e) => setMoveTargets((prev) => ({ ...prev, [enrKey(enr)]: e.target.value }))}
                                    style={{ fontSize: 11, padding: "2px 4px", borderRadius: 4, border: "1px solid #d1d5db" }}
                                  >
                                    {clinicMoveOptions.map((opt) => (
                                      <option key={`clmv-${enrKey(enr)}-${opt.value}`} value={opt.value}>
                                        {opt.label}
                                      </option>
                                    ))}
                                  </select>
                                ) : (
                                  <select
                                    value={moveTargets[enrKey(enr)] || `${enr.day || ""}|${enr.time || ""}`}
                                    onChange={(e) => setMoveTargets((prev) => ({ ...prev, [enrKey(enr)]: e.target.value }))}
                                    style={{ fontSize: 11, padding: "2px 4px", borderRadius: 4, border: "1px solid #d1d5db" }}
                                  >
                                    {Object.entries(enrollSchedules[enr.group] || {}).flatMap(([d, times]) =>
                                      (times || []).map((t) => (
                                        <option key={`mv-${enrKey(enr)}-${d}-${t}`} value={`${d}|${t}`}>
                                          {d} {t}
                                        </option>
                                      ))
                                    )}
                                  </select>
                                )}

                                <button
                                  type="button"
                                  onClick={() => handleMoveEnrollment(enr)}
                                  style={{ padding: "1px 6px", fontSize: 10, borderRadius: 4, border: "1px solid #d1d5db", background: "white", cursor: "pointer" }}
                                >
                                  이동
                                </button>
                              </div>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>

                    {/* 예비 */}
                    <div style={{ minWidth: 220, flex: "1 1 220px" }}>
                      <div style={{ fontSize: 12, fontWeight: "bold", marginBottom: 4 }}>
                        예비 ({reserveList.length}명)
                      </div>
                      {reserveList.length === 0 ? (
                        <div style={{ fontSize: 11, color: "#9ca3af" }}>예비 인원이 없습니다.</div>
                      ) : (
                        <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
                          {reserveList.map((enr) => (
                            <li key={`reserve-${enrKey(enr)}`} style={{ padding: "4px 0", borderBottom: "1px dotted #e5e7eb" }}>
                              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                                <span>
                                  {enr.studentName || enr.name || "-"}
                                  {enr.fromNew ? " (신규)" : ""}
                                  {enr.adminHold ? " (표시용)" : ""}
                                </span>
                                <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
                                  <button
                                    type="button"
                                    onClick={() => promoteReserveToApplied(enr)}
                                    style={{ padding: "1px 6px", fontSize: 10, borderRadius: 4, border: "1px solid #d1d5db", background: "white", cursor: "pointer" }}
                                  >
                                    신청으로
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => deleteEnrollment(enr)}
                                    style={{ padding: "1px 6px", fontSize: 10, borderRadius: 4, border: "1px solid #dc2626", background: "white", color: "#dc2626", cursor: "pointer" }}
                                  >
                                    삭제
                                  </button>
                                </div>
                              </div>

                              <div style={{ marginTop: 3, display: "flex", gap: 4, alignItems: "center", fontSize: 11 }}>
                                <span style={{ color: "#6b7280" }}>이동:</span>
                                <select
                                  value={moveTargets[enrKey(enr)] || `${enr.day || ""}|${enr.time || ""}`}
                                  onChange={(e) => setMoveTargets((prev) => ({ ...prev, [enrKey(enr)]: e.target.value }))}
                                  style={{ fontSize: 11, padding: "2px 4px", borderRadius: 4, border: "1px solid #d1d5db" }}
                                >
                                  {Object.entries(enrollSchedules[enr.group] || {}).flatMap(([d, times]) =>
                                    (times || []).map((t) => (
                                      <option key={`mv2-${enrKey(enr)}-${d}-${t}`} value={`${d}|${t}`}>
                                        {d} {t}
                                      </option>
                                    ))
                                  )}
                                </select>
                                <button
                                  type="button"
                                  onClick={() => handleMoveEnrollment(enr)}
                                  style={{ padding: "1px 6px", fontSize: 10, borderRadius: 4, border: "1px solid #d1d5db", background: "white", cursor: "pointer" }}
                                >
                                  이동
                                </button>
                              </div>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>

                    {/* 기타 */}
                    {pendingList.length > 0 && (
                      <div style={{ minWidth: 180, flex: "1 1 180px" }}>
                        <div style={{ fontSize: 12, fontWeight: "bold", marginBottom: 4 }}>
                          기타 ({pendingList.length}명)
                        </div>
                        <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
                          {pendingList.map((enr) => (
                            <li key={`pending-${enrKey(enr)}`} style={{ padding: "4px 0", borderBottom: "1px dotted #e5e7eb" }}>
                              <div>
                                {enr.studentName || enr.name || "-"} ({enr.status || "기타"}
                                {enr.fromNew ? ", 신규" : ""})
                              </div>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </>
          )}

          {/* ✅ 고등부 */}
          {enrollGroup === "high" && (
            <div>
              <div style={{ marginBottom: 10, fontSize: 13, color: "#4b5563" }}>
                고등부는 <b>요일 기준</b>으로 등록됩니다. (컬렉션: <b>high_enrollments</b>)
              </div>

              <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", padding: 8, border: "1px solid #e5e7eb", borderRadius: 8, marginBottom: 10 }}>
                <div style={{ fontWeight: "bold" }}>고등부 등록</div>
                <input
                  placeholder="studentName"
                  value={highForm.studentName}
                  onChange={(e) => setHighForm((p) => ({ ...p, studentName: e.target.value }))}
                  style={{ padding: "6px 8px", borderRadius: 6, border: "1px solid #d1d5db", fontSize: 12, width: 140 }}
                />
                <input
                  placeholder="studentId"
                  value={highForm.studentId}
                  onChange={(e) => setHighForm((p) => ({ ...p, studentId: e.target.value }))}
                  style={{ padding: "6px 8px", borderRadius: 6, border: "1px solid #d1d5db", fontSize: 12, width: 180 }}
                />
                <select
                  value={highForm.day}
                  onChange={(e) => setHighForm((p) => ({ ...p, day: e.target.value }))}
                  style={{ padding: "6px 8px", borderRadius: 6, border: "1px solid #d1d5db", fontSize: 12 }}
                >
                  {dayList.map((d) => (
                    <option key={`highday-${d}`} value={d}>
                      {d}
                    </option>
                  ))}
                </select>
                <button type="button" onClick={addHighEnrollment} style={{ padding: "6px 10px", borderRadius: 6, border: "1px solid #2563eb", background: "#2563eb", color: "white", cursor: "pointer", fontSize: 12, fontWeight: "bold" }}>
                  + 추가
                </button>
              </div>

              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead>
                  <tr style={{ background: "#f9fafb" }}>
                    <th style={{ textAlign: "left", padding: 8, borderBottom: "1px solid #e5e7eb", width: 70 }}>요일</th>
                    <th style={{ textAlign: "left", padding: 8, borderBottom: "1px solid #e5e7eb", width: 90 }}>인원</th>
                    <th style={{ textAlign: "left", padding: 8, borderBottom: "1px solid #e5e7eb" }}>명단</th>
                  </tr>
                </thead>
                <tbody>
                  {dayList.map((day) => {
                    const list = highByDay[day] || [];
                    return (
                      <tr key={`highrow-${day}`}>
                        <td style={{ padding: 8, borderBottom: "1px solid #f3f4f6", fontWeight: "bold" }}>{day}</td>
                        <td style={{ padding: 8, borderBottom: "1px solid #f3f4f6", color: "#4b5563" }}>{list.length}명</td>
                        <td style={{ padding: 8, borderBottom: "1px solid #f3f4f6" }}>
                          {list.length === 0 ? (
                            <span style={{ color: "#9ca3af", fontSize: 12 }}>등록 없음</span>
                          ) : (
                            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                              {list.map((x) => (
                                <div key={`high-${x.id}`} style={{ border: "1px solid #e5e7eb", borderRadius: 999, padding: "4px 8px", display: "flex", gap: 6, alignItems: "center" }}>
                                  <span>{x.studentName || "-"}</span>
                                  <button
                                    type="button"
                                    onClick={() => deleteHighEnrollment(x)}
                                    style={{ border: "1px solid #dc2626", color: "#dc2626", background: "white", cursor: "pointer", borderRadius: 999, fontSize: 10, padding: "1px 6px" }}
                                  >
                                    삭제
                                  </button>
                                </div>
                              ))}
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* ✅ 심화 */}
          {enrollGroup === "advanced" && (
            <div>
              <div style={{ marginBottom: 10, fontSize: 13, color: "#4b5563" }}>
                심화경시반은 학생별 문서로 관리됩니다. (컬렉션: <b>advanced_by_student</b>)
                <div style={{ marginTop: 4, fontSize: 12, color: "#6b7280" }}>
                  신청(applied=true): {advancedCounts.applied}명 / 미신청(false 또는 없음): {advancedCounts.notApplied}명 / 총 {advancedCounts.total}명
                </div>
              </div>

              <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", padding: 8, border: "1px solid #e5e7eb", borderRadius: 8, marginBottom: 10 }}>
                <div style={{ fontWeight: "bold" }}>심화 등록</div>
                <input
                  placeholder="studentName"
                  value={advancedForm.studentName}
                  onChange={(e) => setAdvancedForm((p) => ({ ...p, studentName: e.target.value }))}
                  style={{ padding: "6px 8px", borderRadius: 6, border: "1px solid #d1d5db", fontSize: 12, width: 140 }}
                />
                <input
                  placeholder="studentId"
                  value={advancedForm.studentId}
                  onChange={(e) => setAdvancedForm((p) => ({ ...p, studentId: e.target.value }))}
                  style={{ padding: "6px 8px", borderRadius: 6, border: "1px solid #d1d5db", fontSize: 12, width: 180 }}
                />
                <button type="button" onClick={addAdvancedStudent} style={{ padding: "6px 10px", borderRadius: 6, border: "1px solid #2563eb", background: "#2563eb", color: "white", cursor: "pointer", fontSize: 12, fontWeight: "bold" }}>
                  + 신청으로 추가
                </button>
              </div>

              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                {advancedByStudent.map((x) => (
                  <div key={`adv-${x.id}`} style={{ border: "1px solid #e5e7eb", borderRadius: 8, padding: 8, minWidth: 220 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center" }}>
                      <div>
                        <div style={{ fontWeight: "bold" }}>{x.studentName || "-"}</div>
                        <div style={{ fontSize: 11, color: "#6b7280" }}>{x.studentId || x.id}</div>
                      </div>
                      <span
                        style={{
                          fontSize: 11,
                          padding: "2px 8px",
                          borderRadius: 999,
                          background: x.applied ? "#dcfce7" : "#fee2e2",
                          color: x.applied ? "#166534" : "#991b1b",
                          border: "1px solid rgba(0,0,0,0.05)",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {x.applied ? "신청" : "미신청"}
                      </span>
                    </div>

                    <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
                      <button
                        type="button"
                        onClick={() => toggleAdvancedApplied(x)}
                        style={{ padding: "6px 10px", borderRadius: 6, border: "1px solid #d1d5db", background: "white", cursor: "pointer", fontSize: 12, fontWeight: "bold" }}
                      >
                        {x.applied ? "미신청으로" : "신청으로"}
                      </button>
                      <button
                        type="button"
                        onClick={() => deleteAdvancedStudent(x)}
                        style={{ padding: "6px 10px", borderRadius: 6, border: "1px solid #dc2626", background: "white", color: "#dc2626", cursor: "pointer", fontSize: 12, fontWeight: "bold" }}
                      >
                        삭제
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default EnrollmentsPage;
