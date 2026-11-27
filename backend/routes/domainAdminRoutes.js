"use strict";

const express = require("express");
const controller = require("../controllers/domainAdminController");

const router = express.Router({ mergeParams: true });

router.patch("/config", controller.updateDomainConfig);
router.post("/", controller.createDomain);
router.get("/", controller.listDomains);
router.get("/:domainId", controller.getDomain);
router.patch("/:domainId", controller.updateDomain);
router.delete("/:domainId", controller.deleteDomain);

module.exports = router;
