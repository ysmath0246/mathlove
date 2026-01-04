// src/pages/AdminAttendanceBookPage.jsx
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
  onSnapshot,
} from "firebase/firestore";

/**
 * ✅ 관리자 출석부 페이지 (블록 리스트 + 출석 테이블)
 *
 * - 오늘/선택 날짜 기준으로 수강신청에서 "블록(반)" 자동 생성
 * - attendance/{dateKey} 문서에서 학생이름 기준으로 입실/하원 실시간 반영
 * - attendance_overrides/{dateKey} 에 관리자 변경(추가/삭제/결석/메모) 저장 → 출석부/출석카드에 반영 가능
 *
 * ⚠️ 주의:
 * - 현재 attendance 문서는 "학생이름"이 필드키인 구조(스샷)라서, 시간 매칭은 studentName으로 합니다.
 * - 동명이인이 생기면 꼬일 수 있으니, 나중에 studentId 기반으로 고도화 가능.
 */

// --------------------
// 날짜/요일 helpers
// --------------------
function pad2(n) {
  return String(n).padStart(2, "0");
}

function dateToKey(d) {
  const y = d.getFullYear();
  const m = pad2(d.getMonth() + 1);
  const day = pad2(d.getDate());
  return `${y}-${m}-${day}`;
}

// JS: 0=일 ... 6=토
const KOR_DAYS = ["일", "월", "화", "수", "목", "금", "토"];
function getKorDay(d) {
  return KOR_DAYS[d.getDay()];
}

function parseTimeToSortKey(timeStr) {
  // "2시30분", "3시", "6시30분" 등 → 분 단위로 정렬용 숫자
  if (!timeStr) return 9999;
  // 클리닉 A/B 같은 경우는 정렬 뒤로
  if (timeStr === "A") return 9000;
  if (timeStr === "B") return 9001;

  // "3시", "2시30분"
  const m = String(timeStr).match(/(\d+)\s*시(?:\s*(\d+)\s*분)?/);
  if (!m) return 9999;
  const hh = Number(m[1] || 0);
  const mm = Number(m[2] || 0);
  return hh * 60 + mm;
}

function groupLabel(group) {
  const map = {
    intensive: "집중학습반",
    elementary: "초등부",
    middle: "중등부",
    middleClinic: "중등부 클리닉",
    high: "고등부",
    advanced: "심화경시반",
  };
  return map[group] || group;
}

function makeBlockKey({ group, day, slotId }) {
  // slotId가 없으면 (예: 고등부가 요일만 운영) group|day 형태
  return slotId ? `${group}|${day}|${slotId}` : `${group}|${day}`;
}

function safeArray(v) {
  if (Array.isArray(v)) return v;
  if (v == null) return [];
  return [v];
}

// --------------------
// Firestore 읽기: 수강신청 → 블록 생성
// (너 스샷 기반으로 최대한 유연하게)
// --------------------
async function buildBlocksFromEnrollments(dayKor) {
  const blocks = new Map(); // blockKey -> block
  const addStudentToBlock = (block, student) => {
    const exists = block.roster.find((s) => s.studentId === student.studentId);
    if (!exists) block.roster.push(student);
  };
  const ensureBlock = ({ group, day, slotId }) => {
    const key = makeBlockKey({ group, day, slotId });
    if (!blocks.has(key)) {
      blocks.set(key, {
        blockKey: key,
        group,
        day,
        slotId: slotId || "",
        roster: [],
      });
    }
    return blocks.get(key);
  };

  // 1) enrollments 컬렉션: {group, day, time, status:"applied", studentId, studentName}
  //    문서ID가 "studentId|group|day|time|..." 같은 형태여도 상관없음
  try {
    const q = query(
      collection(db, "enrollments"),
      where("day", "==", dayKor),
      where("status", "==", "applied")
    );
    const snap = await getDocs(q);
    snap.forEach((d) => {
      const v = d.data();
      const group = v.group;
      const time = v.time; // "3시" 같은 문자열
      const studentId = v.studentId || "";
      const studentName = v.studentName || "";
      if (!group || !studentName) return;

      const block = ensureBlock({ group, day: dayKor, slotId: time });
      addStudentToBlock(block, {
        studentId,
        studentName,
        source: "enrollments",
      });
    });
  } catch (e) {
    // ignore
  }

  // 2) intensive_by_student: 문서ID=studentId, {applied:[{day,time}], studentName}
  //    (스샷에서 applied 배열)
  try {
    const snap = await getDocs(collection(db, "intensive_by_student"));
    snap.forEach((d) => {
      const v = d.data();
      const studentId = v.studentId || d.id;
      const studentName = v.studentName || "";
      const applied = safeArray(v.applied);

      applied.forEach((it) => {
        if (!it) return;
        const day = it.day;
        const time = it.time;
        if (day !== dayKor) return;
        if (!time || !studentName) return;

        const block = ensureBlock({ group: "intensive", day: dayKor, slotId: time });
        addStudentToBlock(block, {
          studentId,
          studentName,
          source: "intensive_by_student",
        });
      });
    });
  } catch (e) {
    // ignore
  }

  // 3) middle_clinic_days: 문서ID=studentId, {regular:{day,blockId,studentId,studentName}, extra:...}
  //    (스샷에서 regular이 객체로 보임. 혹시 배열일 수도 있어서 유연 처리)
  try {
    const snap = await getDocs(collection(db, "middle_clinic_days"));
    snap.forEach((d) => {
      const v = d.data();
      const studentId = v.studentId || d.id;

      const pickItems = (node) => {
        // node가 {day,blockId,...} or 배열일 수 있음
        return safeArray(node).filter(Boolean);
      };

      const regularItems = pickItems(v.regular);
      const extraItems = pickItems(v.extra);

      [...regularItems, ...extraItems].forEach((it) => {
        const day = it.day;
        const blockId = it.blockId; // "A" or "B"
        const studentName = it.studentName || v.studentName || "";
        const sid = it.studentId || studentId;
        if (day !== dayKor) return;
        if (!blockId || !studentName) return;

        const block = ensureBlock({ group: "middleClinic", day: dayKor, slotId: blockId });
        addStudentToBlock(block, {
          studentId: sid,
          studentName,
          source: "middle_clinic_days",
        });
      });
    });
  } catch (e) {
    // ignore
  }

  // 4) advanced_enrollments: (스샷에서 studentId/studentName만 있음)
  //    실제 운영이 요일/시간이 있다면 day/time 필드가 있을 수 있어서 처리해둠.
  try {
    const snap = await getDocs(collection(db, "advanced_enrollments"));
    snap.forEach((d) => {
      const v = d.data();
      const studentId = v.studentId || d.id;
      const studentName = v.studentName || "";
      const day = v.day || ""; // 있을 수도
      const time = v.time || ""; // 있을 수도
      if (!studentName) return;

      if (day && day !== dayKor) return;
      // day가 없으면 "오늘 고정 블록"으로 만들지 말고 스킵(원치 않으면 여기만 바꾸면 됨)
      if (!day) return;

      const block = ensureBlock({
        group: "advanced",
        day: dayKor,
        slotId: time || "", // 없으면 group|day 로
      });
      addStudentToBlock(block, {
        studentId,
        studentName,
        source: "advanced_enrollments",
      });
    });
  } catch (e) {
    // ignore
  }

  // 5) high_enrollments: 문서ID가 studentId|요일 형태. 필드에 day 있음(스샷)
  try {
    const q = query(collection(db, "high_enrollments"), where("day", "==", dayKor));
    const snap = await getDocs(q);
    snap.forEach((d) => {
      const v = d.data();
      const studentId = v.studentId || d.id;
      const studentName = v.studentName || "";
      if (!studentName) return;

      const block = ensureBlock({ group: "high", day: dayKor, slotId: "" }); // 고등: 요일만
      addStudentToBlock(block, {
        studentId,
        studentName,
        source: "high_enrollments",
      });
    });
  } catch (e) {
    // ignore
  }

  // 정렬 + 반환
  const list = Array.from(blocks.values())
    .filter((b) => b.roster.length > 0) // 빈 블록은 제외
    .map((b) => ({
      ...b,
      roster: [...b.roster].sort((a, c) => (a.studentName || "").localeCompare(c.studentName || "ko")),
    }))
    .sort((a, b) => {
      // group 우선순위 + 시간 정렬
      const order = {
        elementary: 1,
        middle: 2,
        intensive: 3,
        middleClinic: 4,
        high: 5,
        advanced: 6,
      };
      const oa = order[a.group] || 99;
      const ob = order[b.group] || 99;
      if (oa !== ob) return oa - ob;

      const ta = parseTimeToSortKey(a.slotId);
      const tb = parseTimeToSortKey(b.slotId);
      return ta - tb;
    });

  return list;
}

// --------------------
// 오버라이드 적용
// --------------------
function applyOverridesToBlocks(blocks, overridesDoc) {
  if (!overridesDoc?.blocks) return blocks;

  const next = blocks.map((b) => {
    const ov = overridesDoc.blocks[b.blockKey];
    if (!ov) return { ...b };

    let roster = [...b.roster];

    // remove
    if (Array.isArray(ov.remove)) {
      const removeSet = new Set(ov.remove.map((x) => x?.studentId).filter(Boolean));
      roster = roster.filter((s) => !removeSet.has(s.studentId));
    }

    // add
    if (Array.isArray(ov.add)) {
      ov.add.forEach((x) => {
        if (!x?.studentName) return;
        const sid = x.studentId || `manual_${x.studentName}`;
        const exists = roster.find((s) => s.studentId === sid);
        if (!exists) {
          roster.push({
            studentId: sid,
            studentName: x.studentName,
            source: "override_add",
          });
        }
      });
    }

    // status/memo
    const statusMap = ov.status || {};
    const memoMap = ov.memo || {};

    roster = roster.map((s) => ({
      ...s,
      forcedStatus: statusMap[s.studentId] || "", // "absent" 등
      forcedMemo: memoMap[s.studentId] || "",
    }));

    roster.sort((a, c) => (a.studentName || "").localeCompare(c.studentName || "ko"));

    return { ...b, roster };
  });

  return next;
}

// --------------------
// UI
// --------------------
export default function AdminAttendanceBookPage() {
  const [date, setDate] = useState(() => new Date());
  const dateKey = useMemo(() => dateToKey(date), [date]);
  const dayKor = useMemo(() => getKorDay(date), [date]);

  // 기본 블록(수강신청 기반)
  const [baseBlocks, setBaseBlocks] = useState([]);
  const [isLoadingBlocks, setIsLoadingBlocks] = useState(false);

  // 오버라이드 문서
  const [overrides, setOverrides] = useState(null);

  // attendance 문서(날짜별): 학생이름 키 구조
  const [attendanceDoc, setAttendanceDoc] = useState(null);

  // 선택 블록
  const [selectedBlockKey, setSelectedBlockKey] = useState("");

  // 추가 모달
  const [addOpen, setAddOpen] = useState(false);
  const [addName, setAddName] = useState("");
  const [addStudentId, setAddStudentId] = useState("");

  // --------------------
  // 실시간 구독: attendance + overrides
  // --------------------
  useEffect(() => {
    const unsub1 = onSnapshot(doc(db, "attendance", dateKey), (snap) => {
      setAttendanceDoc(snap.exists() ? snap.data() : null);
    });

    const unsub2 = onSnapshot(doc(db, "attendance_overrides", dateKey), (snap) => {
      setOverrides(snap.exists() ? snap.data() : null);
    });

    return () => {
      unsub1();
      unsub2();
    };
  }, [dateKey]);

  // attendance: 이름 -> {time, departureTime, status}
  const attendanceByName = useMemo(() => {
    const m = {};
    if (!attendanceDoc) return m;
    Object.entries(attendanceDoc).forEach(([k, v]) => {
      // 스샷처럼 문서 최상단에 학생이름 필드가 있고 값이 객체
      if (v && typeof v === "object" && (v.time || v.departureTime || v.status)) {
        m[k] = v;
      }
    });
    return m;
  }, [attendanceDoc]);

  // 블록 = baseBlocks + overrides 적용
  const blocks = useMemo(() => {
    const applied = applyOverridesToBlocks(baseBlocks, overrides);
    return applied;
  }, [baseBlocks, overrides]);

  // 초기 선택
  useEffect(() => {
    if (!selectedBlockKey && blocks.length > 0) setSelectedBlockKey(blocks[0].blockKey);
    if (selectedBlockKey && blocks.length > 0) {
      const exists = blocks.some((b) => b.blockKey === selectedBlockKey);
      if (!exists) setSelectedBlockKey(blocks[0].blockKey);
    }
  }, [blocks, selectedBlockKey]);

  const selectedBlock = useMemo(
    () => blocks.find((b) => b.blockKey === selectedBlockKey) || null,
    [blocks, selectedBlockKey]
  );

  // --------------------
  // 핸들러: 블록 불러오기
  // --------------------
  const loadBlocks = async () => {
    setIsLoadingBlocks(true);
    try {
      const list = await buildBlocksFromEnrollments(dayKor);
      setBaseBlocks(list);
    } finally {
      setIsLoadingBlocks(false);
    }
  };

  // --------------------
  // 오버라이드 수정 helpers
  // --------------------
  const getOvForBlock = (blockKey) => {
    const blocksOv = overrides?.blocks || {};
    return blocksOv[blockKey] || { add: [], remove: [], status: {}, memo: {} };
  };

  const patchOverrideBlock = async (blockKey, patchFn) => {
    const current = overrides || { blocks: {} };
    const currentBlocks = current.blocks || {};
    const old = currentBlocks[blockKey] || { add: [], remove: [], status: {}, memo: {} };
    const next = patchFn(structuredClone(old));

    const nextDoc = {
      ...current,
      blocks: {
        ...currentBlocks,
        [blockKey]: next,
      },
      updatedAt: serverTimestamp(),
      dateKey,
      day: dayKor,
    };

    await setDoc(doc(db, "attendance_overrides", dateKey), nextDoc, { merge: true });
  };

  // 학생 삭제(이 블록에서만 숨김)
  const removeStudentFromBlock = async (studentId) => {
    if (!selectedBlock) return;
    await patchOverrideBlock(selectedBlock.blockKey, (ov) => {
      ov.remove = Array.isArray(ov.remove) ? ov.remove : [];
      const exists = ov.remove.some((x) => x?.studentId === studentId);
      if (!exists) ov.remove.push({ studentId });
      // add에 같은 학생이 있으면 제거 (충돌 방지)
      ov.add = (ov.add || []).filter((x) => (x?.studentId || "") !== studentId);
      // status/memo도 정리(선택)
      if (ov.status) delete ov.status[studentId];
      if (ov.memo) delete ov.memo[studentId];
      return ov;
    });
  };

  // 학생 추가(이 블록에만 추가)
  const addStudentToBlock = async () => {
    if (!selectedBlock) return;
    const name = addName.trim();
    const sid = addStudentId.trim() || `manual_${name}`;
    if (!name) return;

    await patchOverrideBlock(selectedBlock.blockKey, (ov) => {
      ov.add = Array.isArray(ov.add) ? ov.add : [];
      const exists = ov.add.some((x) => (x?.studentId || "") === sid || x?.studentName === name);
      if (!exists) ov.add.push({ studentId: sid, studentName: name });

      // remove에 들어있으면 제거
      ov.remove = (ov.remove || []).filter((x) => x?.studentId !== sid);
      return ov;
    });

    setAddName("");
    setAddStudentId("");
    setAddOpen(false);
  };

  // 결석 토글(강제 상태)
  const toggleAbsent = async (studentId) => {
    if (!selectedBlock) return;

    await patchOverrideBlock(selectedBlock.blockKey, (ov) => {
      ov.status = ov.status || {};
      const cur = ov.status[studentId] || "";
      ov.status[studentId] = cur === "absent" ? "" : "absent";
      // 빈 문자열이면 키 제거
      if (!ov.status[studentId]) delete ov.status[studentId];
      return ov;
    });
  };

  // 메모 변경
  const setMemo = async (studentId, memo) => {
    if (!selectedBlock) return;

    await patchOverrideBlock(selectedBlock.blockKey, (ov) => {
      ov.memo = ov.memo || {};
      const v = (memo || "").trim();
      if (!v) delete ov.memo[studentId];
      else ov.memo[studentId] = v;
      return ov;
    });
  };

  // "저장" 버튼은 사실상 overrides가 이미 저장되지만, UX상 전체 저장 버튼 제공
  const saveAll = async () => {
    const current = overrides || { blocks: {} };
    await setDoc(
      doc(db, "attendance_overrides", dateKey),
      {
        ...current,
        updatedAt: serverTimestamp(),
        dateKey,
        day: dayKor,
      },
      { merge: true }
    );
    alert("출석부(관리자 변경사항) 저장 완료!");
  };

  // 블록 요약 counts
  const blockCounts = useMemo(() => {
    const map = {};
    blocks.forEach((b) => {
      let inCnt = 0;
      let outCnt = 0;
      let absentCnt = 0;
      let pendingCnt = 0;

      b.roster.forEach((s) => {
        const att = attendanceByName[s.studentName];
        const forcedAbsent = s.forcedStatus === "absent";
        if (forcedAbsent) {
          absentCnt += 1;
          return;
        }
        const inTime = att?.time || "";
        const outTime = att?.departureTime || "";
        if (inTime) inCnt += 1;
        if (outTime) outCnt += 1;
        if (!inTime) pendingCnt += 1;
      });

      map[b.blockKey] = { inCnt, outCnt, absentCnt, pendingCnt, total: b.roster.length };
    });
    return map;
  }, [blocks, attendanceByName]);

  // 상단 전체 요약
  const totalSummary = useMemo(() => {
    let blocksN = blocks.length;
    let inN = 0,
      outN = 0,
      absentN = 0,
      pendingN = 0,
      totalN = 0;

    blocks.forEach((b) => {
      const c = blockCounts[b.blockKey] || { inCnt: 0, outCnt: 0, absentCnt: 0, pendingCnt: 0, total: 0 };
      inN += c.inCnt;
      outN += c.outCnt;
      absentN += c.absentCnt;
      pendingN += c.pendingCnt;
      totalN += c.total;
    });

    return { blocksN, inN, outN, absentN, pendingN, totalN };
  }, [blocks, blockCounts]);

  // --------------------
  // UI
  // --------------------
  return (
    <div style={{ padding: 16, maxWidth: 1200, margin: "0 auto" }}>
      <h2 style={{ margin: "0 0 10px 0" }}>관리자 출석부</h2>

      {/* 헤더 */}
      <div
        style={{
          display: "flex",
          gap: 12,
          alignItems: "center",
          flexWrap: "wrap",
          padding: 12,
          border: "1px solid #e5e7eb",
          borderRadius: 12,
          background: "#fff",
        }}
      >
        <DateBar date={date} setDate={setDate} />
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <Badge text={`블록 ${totalSummary.blocksN}개`} />
          <Badge text={`총 ${totalSummary.totalN}명`} />
          <Badge text={`입실 ${totalSummary.inN}`} />
          <Badge text={`하원 ${totalSummary.outN}`} />
          <Badge text={`미입실 ${totalSummary.pendingN}`} />
          <Badge text={`결석 ${totalSummary.absentN}`} color="#ef4444" />
        </div>

        <div style={{ marginLeft: "auto", display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button
            onClick={loadBlocks}
            style={btnStyle("primary")}
            disabled={isLoadingBlocks}
            title="오늘 요일 기준 수강신청을 읽어서 블록/명단을 생성합니다."
          >
            {isLoadingBlocks ? "불러오는 중..." : "오늘 수강신청 불러오기"}
          </button>
          <button onClick={saveAll} style={btnStyle("dark")}>
            출석부 저장(적용)
          </button>
        </div>

        <div style={{ width: "100%", color: "#6b7280", fontSize: 12, marginTop: 4 }}>
          날짜: <b>{dateKey}</b> · 요일: <b>{dayKor}</b> · 출석시간은{" "}
          <b>attendance/{dateKey}</b>에서 실시간으로 반영됩니다.
        </div>
      </div>

      {/* 본문 */}
      <div style={{ display: "grid", gridTemplateColumns: "320px 1fr", gap: 12, marginTop: 12 }}>
        {/* 좌측 블록 리스트 */}
        <div
          style={{
            border: "1px solid #e5e7eb",
            borderRadius: 12,
            background: "#fff",
            overflow: "hidden",
          }}
        >
          <div style={{ padding: 12, borderBottom: "1px solid #e5e7eb", fontWeight: 700 }}>
            오늘 블록 목록 ({blocks.length})
          </div>

          {blocks.length === 0 ? (
            <div style={{ padding: 12, color: "#6b7280" }}>
              아직 블록이 없습니다. 상단의 <b>오늘 수강신청 불러오기</b>를 눌러주세요.
            </div>
          ) : (
            <div style={{ maxHeight: 620, overflow: "auto" }}>
              {blocks.map((b) => {
                const c = blockCounts[b.blockKey] || {
                  total: b.roster.length,
                  inCnt: 0,
                  outCnt: 0,
                  pendingCnt: 0,
                  absentCnt: 0,
                };
                const isSel = b.blockKey === selectedBlockKey;

                return (
                  <button
                    key={b.blockKey}
                    onClick={() => setSelectedBlockKey(b.blockKey)}
                    style={{
                      width: "100%",
                      textAlign: "left",
                      border: "none",
                      background: isSel ? "#eff6ff" : "transparent",
                      padding: 12,
                      cursor: "pointer",
                      borderBottom: "1px solid #f3f Ala3f4".replace(" ", ""),
                    }}
                  >
                    <div style={{ fontWeight: 800 }}>
                      {groupLabel(b.group)} · {b.day}
                      {b.slotId ? ` · ${b.slotId}` : ""}
                    </div>
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 6 }}>
                      <SmallBadge text={`총 ${c.total}`} />
                      <SmallBadge text={`입실 ${c.inCnt}`} />
                      <SmallBadge text={`하원 ${c.outCnt}`} />
                      <SmallBadge text={`미입실 ${c.pendingCnt}`} />
                      <SmallBadge text={`결석 ${c.absentCnt}`} color="#ef4444" />
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* 우측 테이블 */}
        <div
          style={{
            border: "1px solid #e5e7eb",
            borderRadius: 12,
            background: "#fff",
            overflow: "hidden",
          }}
        >
          <div style={{ padding: 12, borderBottom: "1px solid #e5e7eb", display: "flex", alignItems: "center" }}>
            <div style={{ fontWeight: 900 }}>
              {selectedBlock
                ? `${groupLabel(selectedBlock.group)} · ${selectedBlock.day}${selectedBlock.slotId ? ` · ${selectedBlock.slotId}` : ""}`
                : "블록을 선택하세요"}
            </div>

            <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
              <button
                onClick={() => setAddOpen(true)}
                style={btnStyle("primary")}
                disabled={!selectedBlock}
              >
                + 학생 추가
              </button>
            </div>
          </div>

          {!selectedBlock ? (
            <div style={{ padding: 12, color: "#6b7280" }}>왼쪽에서 블록을 선택해주세요.</div>
          ) : selectedBlock.roster.length === 0 ? (
            <div style={{ padding: 12, color: "#6b7280" }}>이 블록에 학생이 없습니다.</div>
          ) : (
            <div style={{ overflow: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ background: "#f9fafb" }}>
                    <Th>이름</Th>
                    <Th>입실</Th>
                    <Th>하원</Th>
                    <Th>상태</Th>
                    <Th>메모</Th>
                    <Th>조작</Th>
                  </tr>
                </thead>
                <tbody>
                  {selectedBlock.roster.map((s) => {
                    const att = attendanceByName[s.studentName] || null;
                    const inTime = att?.time || "";
                    const outTime = att?.departureTime || "";
                    const forcedAbsent = s.forcedStatus === "absent";

                    const statusLabel = forcedAbsent
                      ? "결석(강제)"
                      : inTime
                      ? "출석"
                      : "미입실";

                    return (
                      <tr key={`${s.studentId}_${s.studentName}`} style={{ borderTop: "1px solid #eef2f7" }}>
                        <Td>
                          <div style={{ fontWeight: 800 }}>{s.studentName}</div>
                          <div style={{ fontSize: 12, color: "#6b7280" }}>
                            {s.studentId ? `ID: ${s.studentId}` : ""}{" "}
                            {s.source ? `· ${s.source}` : ""}
                          </div>
                        </Td>
                        <Td>{inTime || "-"}</Td>
                        <Td>{outTime || "-"}</Td>
                        <Td>
                          <span
                            style={{
                              padding: "4px 10px",
                              borderRadius: 999,
                              fontWeight: 800,
                              fontSize: 12,
                              color: forcedAbsent ? "#991b1b" : inTime ? "#065f46" : "#374151",
                              background: forcedAbsent ? "#fee2e2" : inTime ? "#d1fae5" : "#e5e7eb",
                            }}
                          >
                            {statusLabel}
                          </span>
                        </Td>
                        <Td style={{ minWidth: 160 }}>
                          <MemoInput
                            value={s.forcedMemo || ""}
                            onSave={(v) => setMemo(s.studentId, v)}
                          />
                        </Td>
                        <Td style={{ whiteSpace: "nowrap" }}>
                          <button
                            onClick={() => toggleAbsent(s.studentId)}
                            style={{
                              ...miniBtnStyle,
                              background: forcedAbsent ? "#111827" : "#ef4444",
                            }}
                          >
                            {forcedAbsent ? "결석해제" : "결석"}
                          </button>
                          <button
                            onClick={() => removeStudentFromBlock(s.studentId)}
                            style={{ ...miniBtnStyle, background: "#6b7280" }}
                          >
                            삭제
                          </button>
                        </Td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>

              <div style={{ padding: 12, color: "#6b7280", fontSize: 12 }}>
                ✅ 결석/삭제/추가/메모는 <b>attendance_overrides/{dateKey}</b>에 저장됩니다. <br />
                ✅ 입실/하원 시간은 <b>attendance/{dateKey}</b> 문서에서 실시간으로 읽어옵니다.
              </div>
            </div>
          )}
        </div>
      </div>

      {/* 추가 모달 */}
      {addOpen && selectedBlock && (
        <Modal onClose={() => setAddOpen(false)} title="학생 추가">
          <div style={{ display: "grid", gap: 10 }}>
            <div style={{ fontSize: 13, color: "#6b7280" }}>
              선택 블록: <b>{groupLabel(selectedBlock.group)}</b> · <b>{selectedBlock.day}</b>
              {selectedBlock.slotId ? ` · ${selectedBlock.slotId}` : ""}
            </div>

            <label style={labelStyle}>
              학생 이름
              <input
                value={addName}
                onChange={(e) => setAddName(e.target.value)}
                placeholder="예: 조성빈"
                style={inputStyle}
              />
            </label>

            <label style={labelStyle}>
              학생 ID (선택)
              <input
                value={addStudentId}
                onChange={(e) => setAddStudentId(e.target.value)}
                placeholder="예: OLbSKvm1buEwjhompOaS (없으면 비워도 됨)"
                style={inputStyle}
              />
            </label>

            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button onClick={() => setAddOpen(false)} style={btnStyle("light")}>
                취소
              </button>
              <button onClick={addStudentToBlock} style={btnStyle("primary")}>
                추가
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

// --------------------
// Small components/styles
// --------------------
function DateBar({ date, setDate }) {
  const dateKey = dateToKey(date);

  const move = (deltaDays) => {
    const d = new Date(date);
    d.setDate(d.getDate() + deltaDays);
    setDate(d);
  };

  return (
    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
      <button onClick={() => move(-1)} style={btnStyle("light")}>
        ◀
      </button>

      <input
        type="date"
        value={dateKey}
        onChange={(e) => {
          const v = e.target.value;
          if (!v) return;
          const [y, m, d] = v.split("-").map(Number);
          setDate(new Date(y, m - 1, d));
        }}
        style={{
          padding: "8px 10px",
          borderRadius: 10,
          border: "1px solid #e5e7eb",
          fontWeight: 700,
        }}
      />

      <button onClick={() => move(1)} style={btnStyle("light")}>
        ▶
      </button>

      <button onClick={() => setDate(new Date())} style={btnStyle("light")}>
        오늘
      </button>
    </div>
  );
}

function Badge({ text, color = "#2563eb" }) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        padding: "6px 10px",
        borderRadius: 999,
        border: `1px solid ${color}33`,
        background: `${color}11`,
        color,
        fontWeight: 900,
        fontSize: 12,
      }}
    >
      {text}
    </span>
  );
}

function SmallBadge({ text, color = "#2563eb" }) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        padding: "2px 8px",
        borderRadius: 999,
        border: `1px solid ${color}33`,
        background: `${color}11`,
        color,
        fontWeight: 900,
        fontSize: 12,
      }}
    >
      {text}
    </span>
  );
}

function Th({ children }) {
  return (
    <th style={{ textAlign: "left", padding: "10px 12px", fontSize: 12, color: "#374151" }}>
      {children}
    </th>
  );
}

function Td({ children }) {
  return <td style={{ padding: "10px 12px", verticalAlign: "top" }}>{children}</td>;
}

function Modal({ title, children, onClose }) {
  return (
    <div
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose?.();
      }}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.35)",
        display: "grid",
        placeItems: "center",
        zIndex: 9999,
        padding: 12,
      }}
    >
      <div
        style={{
          width: "min(520px, 100%)",
          background: "#fff",
          borderRadius: 14,
          border: "1px solid #e5e7eb",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            padding: 12,
            borderBottom: "1px solid #e5e7eb",
            display: "flex",
            alignItems: "center",
            gap: 8,
          }}
        >
          <div style={{ fontWeight: 900 }}>{title}</div>
          <div style={{ marginLeft: "auto" }}>
            <button onClick={onClose} style={btnStyle("light")}>
              닫기
            </button>
          </div>
        </div>
        <div style={{ padding: 12 }}>{children}</div>
      </div>
    </div>
  );
}

function MemoInput({ value, onSave }) {
  const [v, setV] = useState(value || "");
  useEffect(() => setV(value || ""), [value]);

  return (
    <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
      <input
        value={v}
        onChange={(e) => setV(e.target.value)}
        placeholder="메모(선택)"
        style={{
          padding: "6px 8px",
          borderRadius: 10,
          border: "1px solid #e5e7eb",
          width: 140,
          fontSize: 12,
        }}
      />
      <button onClick={() => onSave?.(v)} style={{ ...miniBtnStyle, background: "#2563eb" }}>
        저장
      </button>
    </div>
  );
}

const btnStyle = (type) => {
  const base = {
    padding: "8px 12px",
    borderRadius: 12,
    border: "1px solid #e5e7eb",
    cursor: "pointer",
    fontWeight: 900,
    background: "#fff",
  };
  if (type === "primary") {
    return { ...base, background: "#2563eb", borderColor: "#2563eb", color: "#fff" };
  }
  if (type === "dark") {
    return { ...base, background: "#111827", borderColor: "#111827", color: "#fff" };
  }
  if (type === "light") {
    return { ...base, background: "#f9fafb" };
  }
  return base;
};

const miniBtnStyle = {
  padding: "6px 10px",
  borderRadius: 10,
  border: "none",
  color: "#fff",
  fontWeight: 900,
  cursor: "pointer",
  marginRight: 6,
  fontSize: 12,
};

const labelStyle = { display: "grid", gap: 6, fontSize: 13, fontWeight: 800 };
const inputStyle = {
  padding: "10px 12px",
  borderRadius: 12,
  border: "1px solid #e5e7eb",
  fontWeight: 700,
};
