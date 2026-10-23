package com.pmp.app;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/dashboard")
public class DashboardController {

    private final DashboardService dashboard;
    private final CurrentUser currentUser;

    public DashboardController(DashboardService dashboard, CurrentUser currentUser) {
        this.dashboard = dashboard;
        this.currentUser = currentUser;
    }

    @GetMapping
    public Dto.DashboardView summary() {
        return dashboard.forAccount(currentUser.require());
    }
}
