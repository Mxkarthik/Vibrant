"use strict";

const express = require("express");
const controller = require("../controllers/domainAdminController");

const router = express.Router({ mergeParams: true });

router.patch("/config", controller.updateDomainConfig);
router.post("/open", controller.openDomainDraw);
router.post("/close", controller.closeDomainDraw);
router.post("/enable-read", controller.enableDomainRead);
router.post("/revise", controller.reviseDomainPool);
router.post("/reset-to-draft", controller.resetLotteryToDraft);
router.post("/clear-draft", controller.clearDraftDomains);
router.get("/status", controller.getDomainLifecycleStatus);
router.post("/", controller.createDomain);
router.get("/", controller.listDomains);
router.get("/:domainId", controller.getDomain);
router.patch("/:domainId", controller.updateDomain);
router.delete("/:domainId", controller.deleteDomain);

module.exports = router;
