package com.petproject.cowsandbulls;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.scheduling.annotation.EnableScheduling;

// @EnableScheduling switches on the @Scheduled sweeps that evict idle games
// and rooms. Without it those methods are simply never called - which is how
// the game map was able to grow without limit.
@EnableScheduling
@SpringBootApplication
public class CowsAndBullsApplication {

    public static void main(String[] args) {
        SpringApplication.run(CowsAndBullsApplication.class, args);
    }

}
